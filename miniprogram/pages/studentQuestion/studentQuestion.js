const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    lessonId: "",
    classId: "",
    name: "",
    studentId: "",
    currentUser: null,
    signSuccess: false,
    questionRequestCount: 0,
    hasPendingQuestionRequest: false,
    latestQuestionStatusText: "",
    latestQuestionStatusType: "",
    canSubmitQuestionRequest: false
  },

  getPendingLessonId() {
    return String(wx.getStorageSync("pendingLessonId") || "").trim();
  },

  resolveLessonId(options = {}) {
    return String(options.lessonId || this.getPendingLessonId() || "").trim();
  },

  async ensureLessonClassId() {
    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();
    if (!lessonId || this.data.classId) return this.data.classId;

    try {
      const res = await db.collection("lessons").doc(lessonId).get();
      const lessonClassId = String(res.data?.classId || "").trim();
      if (lessonClassId) {
        this.setData({ classId: lessonClassId });
        return lessonClassId;
      }
    } catch (err) {
      console.error("[studentQuestion] ensureLessonClassId failed", err);
    }

    if (!studentId) return "";

    try {
      const attendanceRes = await db.collection("attendance")
        .where({ lessonId, studentId })
        .limit(1)
        .get();
      const attendanceClassId = String(attendanceRes.data?.[0]?.classId || "").trim();
      if (attendanceClassId) {
        this.setData({ classId: attendanceClassId });
        return attendanceClassId;
      }
    } catch (err) {
      console.error("[studentQuestion] ensureLessonClassId fallback failed", err);
    }

    return "";
  },

  async restoreSignSuccessStatus() {
    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();

    if (!lessonId || !studentId) {
      this.setData({
        signSuccess: false,
        canSubmitQuestionRequest: false
      });
      return false;
    }

    try {
      const res = await db.collection("attendance")
        .where({ lessonId, studentId })
        .limit(1)
        .get();
      const hasSigned = Array.isArray(res.data) && res.data.length > 0;
      this.setData({
        signSuccess: hasSigned,
        canSubmitQuestionRequest: hasSigned
      });
      return hasSigned;
    } catch (err) {
      console.error("[studentQuestion] restoreSignSuccessStatus failed", err);
      return false;
    }
  },

  getQuestionStudentKey() {
    return String(
      this.data.studentId ||
      this.data.currentUser?.studentId ||
      this.data.currentUser?.id ||
      this.data.currentUser?._openid ||
      this.data.name ||
      ""
    ).trim();
  },

  async loadQuestionRequestState() {
    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();
    const studentKey = this.getQuestionStudentKey();

    if (!lessonId || !studentKey || !studentId) {
      this.setData({
        questionRequestCount: 0,
        hasPendingQuestionRequest: false,
        latestQuestionStatusText: "",
        latestQuestionStatusType: "",
        canSubmitQuestionRequest: false
      });
      return;
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          lessonId,
          studentId,
          type: _.in(["question_request", "question_approved", "question_score"])
        })
        .get();
      const events = res.data || [];
      const myEvents = events.filter((item) => {
        const itemKey = String(
          item.studentId ||
          item.id ||
          item.openid ||
          item._openid ||
          item.studentName ||
          ""
        ).trim();
        return itemKey === studentKey;
      });

      const requestIds = new Set(
        myEvents
          .filter((item) => item.type === "question_request")
          .map((item) => String(item._id || "").trim())
          .filter(Boolean)
      );
      const approvedIds = new Set(
        myEvents
          .filter((item) => item.type === "question_approved")
          .map((item) => String(item.payload?.requestId || "").trim())
          .filter(Boolean)
      );
      const scoredIds = new Set(
        myEvents
          .filter((item) => item.type === "question_score")
          .map((item) => String(item.payload?.requestId || "").trim())
          .filter(Boolean)
      );

      const hasPendingQuestionRequest = Array.from(requestIds).some(
        (requestId) => !approvedIds.has(requestId) && !scoredIds.has(requestId)
      );

      let latestQuestionStatusText = "";
      let latestQuestionStatusType = "";
      if (hasPendingQuestionRequest) {
        latestQuestionStatusText = "你已有待处理提问申请，请等待老师处理。";
        latestQuestionStatusType = "pending";
      } else if (scoredIds.size > 0) {
        latestQuestionStatusText = "最近一次主动提问已完成课堂评分。";
        latestQuestionStatusType = "scored";
      } else if (approvedIds.size > 0) {
        latestQuestionStatusText = "最近一次主动提问已通过，等待老师点你发言。";
        latestQuestionStatusType = "approved";
      }

      const canSubmitQuestionRequest =
        this.data.signSuccess &&
        requestIds.size < 3 &&
        !hasPendingQuestionRequest;

      this.setData({
        questionRequestCount: requestIds.size,
        hasPendingQuestionRequest,
        latestQuestionStatusText,
        latestQuestionStatusType,
        canSubmitQuestionRequest
      });
    } catch (err) {
      console.error("[studentQuestion] loadQuestionRequestState failed", err);
    }
  },

  ensureInteractionAllowed(actionLabel = "主动提问") {
    if (this.data.signSuccess) return true;
    wx.showToast({ title: `请先完成签到后再${actionLabel}`, icon: "none" });
    return false;
  },

  async submitQuestionRequest() {
    if (!this.ensureInteractionAllowed("主动提问")) {
      return;
    }

    const currentUser = this.data.currentUser || null;
    const lessonId = String(this.data.lessonId || this.getPendingLessonId() || "").trim();
    const studentId = String(
      this.data.studentId ||
      currentUser.studentId ||
      currentUser.id ||
      ""
    ).trim();
    const studentName = String(
      this.data.name ||
      currentUser.name ||
      currentUser.studentName ||
      ""
    ).trim();
    const classId = String(
      (await this.ensureLessonClassId()) ||
      this.data.classId ||
      currentUser.classId ||
      ""
    ).trim();

    if (!lessonId || !classId || !studentId || !studentName) {
      wx.showToast({ title: "当前课堂信息不完整", icon: "none" });
      return;
    }

    await this.loadQuestionRequestState();

    if (this.data.questionRequestCount >= 3) {
      wx.showToast({ title: "本节课提问次数已达上限", icon: "none" });
      return;
    }

    if (this.data.hasPendingQuestionRequest) {
      wx.showToast({ title: "你已有待处理提问申请", icon: "none" });
      return;
    }

    try {
      await db.collection("lessonEvent").add({
        data: {
          lessonId,
          classId,
          studentId,
          studentName,
          type: "question_request",
          score: 0,
          round: 0,
          payload: { source: "student_apply" },
          createdAt: db.serverDate(),
          createdBy: "student"
        }
      });
      await this.loadQuestionRequestState();
      wx.showToast({ title: "提问申请已提交", icon: "none" });
    } catch (err) {
      console.error("[studentQuestion] submitQuestionRequest failed", err);
      wx.showToast({ title: "申请失败，请稍后重试", icon: "none" });
    }
  },

  async initPageState(options = {}) {
    const lessonId = this.resolveLessonId(options);
    if (!lessonId) {
      wx.showModal({
        title: "进入失败",
        content: "当前没有可用课堂，请先从学生主页进入。",
        showCancel: false
      });
      return;
    }

    wx.setStorageSync("pendingLessonId", lessonId);
    wx.showLoading({ title: "加载中...", mask: true });

    try {
      const res = await wx.cloud.callFunction({ name: "getMyUser" });
      wx.hideLoading();

      const result = res.result || {};
      const currentUser = result.user || {};
      const name = String(currentUser.name || "").trim();
      const studentId = String(currentUser.studentId || "").trim();
      const shouldGoRegister = !result.success || !result.bound || !name || !studentId;

      if (shouldGoRegister) {
        wx.showToast({ title: "请先绑定后再主动提问", icon: "none" });
        wx.navigateTo({
          url: `/pages/register/register?lessonId=${encodeURIComponent(lessonId)}&scene=${encodeURIComponent(lessonId)}`
        });
        return;
      }

      wx.setStorageSync("currentUser", currentUser);
      this.setData({
        lessonId,
        classId: String(currentUser.classId || "").trim(),
        name,
        studentId,
        currentUser
      });

      await this.ensureLessonClassId();
      await this.restoreSignSuccessStatus();
      await this.loadQuestionRequestState();
    } catch (err) {
      wx.hideLoading();
      console.error("[studentQuestion] initPageState failed", err);
      wx.showToast({ title: "服务请求失败", icon: "none" });
    }
  },

  onLoad(options) {
    this.initPageState(options);
  },

  onShow() {
    if (!this.data.lessonId || !this.data.studentId) return;
    this.restoreSignSuccessStatus().then(() => this.loadQuestionRequestState());
  }
});
