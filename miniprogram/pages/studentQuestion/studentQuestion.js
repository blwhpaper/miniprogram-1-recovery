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
    pageStatusText: "未签到",
    questionRequestCount: 0,
    hasPendingQuestionRequest: false,
    latestQuestionStatusText: "",
    latestQuestionStatusType: "",
    canSubmitQuestionRequest: false,
    heroStatusTag: "未发起",
    heroStatusType: "disabled",
    heroStatusText: "当前还未发起提问请求",
    requestStageTitle: "准备发起提问",
    requestStageDesc: "点击下方按钮后，老师会在教师端收到你的提问申请。",
    requestSummaryText: "本课已发起提问 0 / 3 次",
    requestSummaryType: "info",
    requestNoticeText: "请先完成签到，再发起提问。",
    requestNoticeType: "warning",
    actionButtonText: "发起提问",
    bottomHintText: "当前还未发起提问请求"
  },

  questionPollingTimer: null,
  hasHydratedQuestionStatus: false,

  getWishScoreStatusText(score = 0) {
    const numericScore = Number(score || 0);
    if (numericScore === 95) {
      return "是不是飘飘欲仙，如在云端了？还来不的了？";
    }
    if (numericScore === 80) {
      return "惊不惊喜？意不意外？想不想再来一次？";
    }
    if (numericScore === 60) {
      return "不是每个愿望都那么容易实现的，要不，咱们换个“简单”点的？";
    }
    return "";
  },

  getWishScoreResultText(score = 0) {
    const numericScore = Number(score || 0);
    const wishStatusText = this.getWishScoreStatusText(numericScore);
    if (!wishStatusText) return "";
    return `${numericScore}分。${wishStatusText}`;
  },

  syncPageState(nextState = {}) {
    const changedState = {};

    Object.keys(nextState).forEach((key) => {
      if (this.data[key] !== nextState[key]) {
        changedState[key] = nextState[key];
      }
    });

    if (Object.keys(changedState).length > 0) {
      this.setData(changedState);
    }

    return changedState;
  },

  buildQuestionUiState(baseState = {}) {
    const signSuccess = Boolean(baseState.signSuccess);
    const latestQuestionStatusType = String(baseState.latestQuestionStatusType || "").trim();
    const latestQuestionStatusText = String(baseState.latestQuestionStatusText || "").trim();
    const questionRequestCount = Number(baseState.questionRequestCount || 0);
    const canSubmitQuestionRequest = Boolean(baseState.canSubmitQuestionRequest);

    const uiState = {
      heroStatusTag: "未发起",
      heroStatusType: "disabled",
      heroStatusText: signSuccess ? "当前还未发起提问请求" : "请先签到后再发起提问",
      requestStageTitle: signSuccess ? "准备发起提问" : "签到后可发起提问",
      requestStageDesc: signSuccess
        ? "点击下方按钮后，老师会在教师端收到你的提问申请。"
        : "当前课堂尚未签到成功，完成签到后即可向老师发起提问信号。",
      requestSummaryText: `本课已发起提问 ${questionRequestCount} / 3 次`,
      requestSummaryType: questionRequestCount > 0 ? "info" : "idle",
      requestNoticeText: signSuccess ? "点击下方按钮即可发起提问。" : "请先完成签到，再发起提问。",
      requestNoticeType: signSuccess ? "info" : "warning",
      actionButtonText: "发起提问",
      bottomHintText: signSuccess ? "发起后请留意老师处理结果" : "请先完成签到"
    };

    if (latestQuestionStatusType === "pending") {
      uiState.heroStatusTag = "等待中";
      uiState.heroStatusType = "info";
      uiState.heroStatusText = "请求已发送，等待老师处理";
      uiState.requestStageTitle = "请求已发送";
      uiState.requestStageDesc = "老师正在查看你的提问申请，请准备口头提问内容。";
      uiState.requestNoticeText = "请求已发送，等待老师处理。";
      uiState.requestNoticeType = "info";
      uiState.actionButtonText = "请求已发送";
      uiState.bottomHintText = "老师处理后，页面会自动更新";
      return uiState;
    }

    if (latestQuestionStatusType === "approved") {
      uiState.heroStatusTag = "已允许";
      uiState.heroStatusType = "success";
      uiState.heroStatusText = "老师已允许，请开始口头提问";
      uiState.requestStageTitle = "老师已允许";
      uiState.requestStageDesc = "请立即开始口头提问，保持表达简洁清晰。";
      uiState.requestNoticeText = "老师已允许，请开始口头提问。";
      uiState.requestNoticeType = "success";
      uiState.actionButtonText = "老师已允许";
      uiState.bottomHintText = "当前已进入口头提问阶段";
      return uiState;
    }

    if (latestQuestionStatusType === "scored") {
      uiState.heroStatusTag = "已完成";
      uiState.heroStatusType = "success";
      uiState.heroStatusText = "本次提问已完成";
      uiState.requestStageTitle = "本次提问已完成";
      uiState.requestStageDesc = latestQuestionStatusText || "本次提问流程已结束。";
      uiState.requestNoticeText = latestQuestionStatusText || "本次提问流程已结束。";
      uiState.requestNoticeType = "success";
      uiState.actionButtonText = canSubmitQuestionRequest ? "再次发起提问" : "发起提问";
      uiState.bottomHintText = canSubmitQuestionRequest ? "如需再次提问，可重新发起申请" : "本次提问流程已结束";
      return uiState;
    }

    if (latestQuestionStatusType === "exhausted" || (!canSubmitQuestionRequest && signSuccess && questionRequestCount >= 3)) {
      uiState.heroStatusTag = "已用完";
      uiState.heroStatusType = "disabled";
      uiState.heroStatusText = "本课提问次数已用完";
      uiState.requestStageTitle = "本课提问次数已用完";
      uiState.requestStageDesc = "本节课最多可发起 3 次提问，请等待下次课堂。";
      uiState.requestNoticeText = latestQuestionStatusText || "本节课提问次数已用完。";
      uiState.requestNoticeType = "warning";
      uiState.bottomHintText = "本节课暂不可继续发起提问";
      return uiState;
    }

    return uiState;
  },

  shouldKeepQuestionPolling(state = {}) {
    const questionRequestCount = Number(
      state.questionRequestCount !== undefined ? state.questionRequestCount : this.data.questionRequestCount
    );
    const hasPendingQuestionRequest = Boolean(
      state.hasPendingQuestionRequest !== undefined ? state.hasPendingQuestionRequest : this.data.hasPendingQuestionRequest
    );
    const latestQuestionStatusType = String(
      state.latestQuestionStatusType !== undefined ? state.latestQuestionStatusType : this.data.latestQuestionStatusType
    ).trim();

    if (hasPendingQuestionRequest || latestQuestionStatusType === "approved") {
      return true;
    }
    if (questionRequestCount >= 3) return false;
    return false;
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

  async restoreSignSuccessStatus(options = {}) {
    const { apply = true } = options;
    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();

    if (!lessonId || !studentId) {
      const nextState = { signSuccess: false };
      if (apply) {
        this.syncPageState(nextState);
      }
      return nextState;
    }

    try {
      const res = await db.collection("attendance")
        .where({ lessonId, studentId })
        .limit(1)
        .get();
      const hasSigned = Array.isArray(res.data) && res.data.length > 0;
      const nextState = { signSuccess: hasSigned };
      if (apply) {
        this.syncPageState(nextState);
      }
      return nextState;
    } catch (err) {
      console.error("[studentQuestion] restoreSignSuccessStatus failed", err);
      return { signSuccess: false };
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

  async loadQuestionRequestState(options = {}) {
    const {
      signSuccess = this.data.signSuccess,
      apply = true
    } = options;
    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();
    const studentKey = this.getQuestionStudentKey();

    if (!lessonId || !studentKey || !studentId) {
      const nextState = {
        pageStatusText: signSuccess ? "可提问" : "未签到",
        questionRequestCount: 0,
        hasPendingQuestionRequest: false,
        latestQuestionStatusText: "",
        latestQuestionStatusType: "",
        canSubmitQuestionRequest: false
      };
      if (apply) {
        this.syncPageState(nextState);
        this.syncQuestionPolling(nextState);
      }
      return nextState;
    }

    try {
      console.log("[studentQuestion] query lesson events", {
        lessonId,
        studentId,
        studentKey
      });
      const res = await db.collection("lessonEvent")
        .where({
          lessonId,
          type: _.in(["question_request", "question_approved", "question_score"])
        })
        .orderBy("createdAt", "desc")
        .get();
      const events = res.data || [];
      const requestEvents = events.filter((item) => item.type === "question_request");
      const myRequestEvents = requestEvents.filter((item) => {
        const itemKey = String(
          item.studentId ||
          item.id ||
          item.openid ||
          item._openid ||
          item.studentName ||
          ""
        ).trim();
        return itemKey === studentKey || String(item.studentName || "").trim() === String(this.data.name || "").trim();
      });
      const myRequestIds = new Set(
        myRequestEvents
          .map((item) => String(item._id || "").trim())
          .filter(Boolean)
      );

      const myApprovedEvents = events.filter((item) => {
        if (item.type !== "question_approved") return false;
        const requestId = String(item.payload?.requestId || "").trim();
        return myRequestIds.has(requestId);
      });
      const myScoreEvents = events.filter((item) => {
        if (item.type !== "question_score") return false;
        const requestId = String(item.payload?.requestId || "").trim();
        return myRequestIds.has(requestId);
      });

      const requestIds = new Set(
        Array.from(myRequestIds)
      );
      const approvedIds = new Set(
        myApprovedEvents
          .map((item) => String(item.payload?.requestId || "").trim())
          .filter(Boolean)
      );
      const scoredIds = new Set(
        myScoreEvents
          .map((item) => String(item.payload?.requestId || "").trim())
          .filter(Boolean)
      );

      const hasPendingQuestionRequest = Array.from(requestIds).some(
        (requestId) => !approvedIds.has(requestId) && !scoredIds.has(requestId)
      );
      const hasApprovedUnscoredQuestionRequest = Array.from(requestIds).some(
        (requestId) => approvedIds.has(requestId) && !scoredIds.has(requestId)
      );

      let latestQuestionStatusText = "";
      let latestQuestionStatusType = "";
      const isQuestionQuotaExhausted =
        requestIds.size >= 3 &&
        !hasPendingQuestionRequest &&
        !hasApprovedUnscoredQuestionRequest &&
        scoredIds.size >= requestIds.size;

      if (hasPendingQuestionRequest) {
        latestQuestionStatusText = "你的愿望已飞鸽传书给老师，请静候佳音。";
        latestQuestionStatusType = "pending";
      } else if (hasApprovedUnscoredQuestionRequest) {
        latestQuestionStatusText = "你的愿望老师收到了，现在，用英语大胆把它说出来吧。";
        latestQuestionStatusType = "approved";
      } else if (scoredIds.size > 0) {
        const latestScoreEvent = myScoreEvents[0] || null;
        const latestScore = latestScoreEvent ? Number(latestScoreEvent.score || 0) : 0;
        latestQuestionStatusText = this.getWishScoreResultText(latestScore);
        latestQuestionStatusType = "scored";
      } else if (approvedIds.size > 0) {
        latestQuestionStatusText = "你的愿望老师收到了，现在，用英语大胆把它说出来吧。";
        latestQuestionStatusType = "approved";
      } else if (isQuestionQuotaExhausted) {
        latestQuestionStatusText = "你的三个愿望已经用完啦，下次课还有机会哦，骚年！";
        latestQuestionStatusType = "exhausted";
      }

      const canSubmitQuestionRequest =
        signSuccess &&
        requestIds.size < 3 &&
        !hasPendingQuestionRequest &&
        !hasApprovedUnscoredQuestionRequest;

      console.log("[studentQuestion] query result", {
        totalEvents: events.length,
        myRequestCount: myRequestEvents.length,
        myApprovedCount: myApprovedEvents.length,
        myScoreCount: myScoreEvents.length,
        hasPendingQuestionRequest,
        hasApprovedUnscoredQuestionRequest,
        latestQuestionStatusType,
        canSubmitQuestionRequest
      });

      const nextState = {
        pageStatusText: signSuccess ? "可提问" : "未签到",
        questionRequestCount: requestIds.size,
        hasPendingQuestionRequest,
        latestQuestionStatusText,
        latestQuestionStatusType,
        canSubmitQuestionRequest
      };
      if (latestQuestionStatusType === "pending") {
        nextState.pageStatusText = "已提交";
      } else if (latestQuestionStatusType === "approved") {
        nextState.pageStatusText = "待评分";
      } else if (latestQuestionStatusType === "exhausted" || isQuestionQuotaExhausted) {
        nextState.pageStatusText = "次数已用完";
      } else if (!canSubmitQuestionRequest) {
        nextState.pageStatusText = signSuccess ? "暂不可提问" : "未签到";
      }
      Object.assign(nextState, this.buildQuestionUiState(nextState));
      if (apply) {
        const changedState = this.syncPageState(nextState);
        console.log("[studentQuestion] setData", {
          changedKeys: Object.keys(changedState),
          ...nextState
        });
        this.syncQuestionPolling(nextState);
      }
      return nextState;
    } catch (err) {
      console.error("[studentQuestion] loadQuestionRequestState failed", err);
      return {
        pageStatusText: this.data.pageStatusText,
        questionRequestCount: this.data.questionRequestCount,
        hasPendingQuestionRequest: this.data.hasPendingQuestionRequest,
        latestQuestionStatusText: this.data.latestQuestionStatusText,
        latestQuestionStatusType: this.data.latestQuestionStatusType,
        canSubmitQuestionRequest: this.data.canSubmitQuestionRequest
      };
    }
  },

  async refreshQuestionPageState() {
    if (!this.data.lessonId || !this.data.studentId) return;
    console.log("[studentQuestion] refreshQuestionPageState", {
      lessonId: this.data.lessonId,
      studentId: this.data.studentId
    });
    const signState = await this.restoreSignSuccessStatus({ apply: false });
    const questionState = await this.loadQuestionRequestState({
      signSuccess: !!signState.signSuccess,
      apply: false
    });
    const nextState = {
      ...signState,
      ...questionState
    };
    Object.assign(nextState, this.buildQuestionUiState(nextState));
    const previousQuestionStatusType = String(this.data.latestQuestionStatusType || "").trim();
    const nextQuestionStatusType = String(nextState.latestQuestionStatusType || "").trim();
    const shouldVibrateOnApproved =
      this.hasHydratedQuestionStatus &&
      previousQuestionStatusType !== "approved" &&
      nextQuestionStatusType === "approved";
    const changedState = this.syncPageState(nextState);
    console.log("[studentQuestion] setData", {
      changedKeys: Object.keys(changedState),
      ...nextState
    });
    if (shouldVibrateOnApproved) {
      wx.vibrateShort({ type: "light" });
    }
    this.hasHydratedQuestionStatus = true;
    this.syncQuestionPolling(nextState);
  },

  startQuestionPolling() {
    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();
    if (!lessonId || !studentId) return;
    if (!this.shouldKeepQuestionPolling()) return;

    if (this.questionPollingTimer) return;

    console.log("[studentQuestion] startQuestionPolling", { lessonId, studentId });
    this.questionPollingTimer = setInterval(() => {
      console.log("[studentQuestion] polling tick", {
        lessonId: this.data.lessonId,
        studentId: this.data.studentId
      });
      this.refreshQuestionPageState();
    }, 5000);
  },

  syncQuestionPolling(state = {}) {
    if (this.shouldKeepQuestionPolling(state)) {
      this.startQuestionPolling();
      return;
    }
    this.clearQuestionPolling();
  },

  clearQuestionPolling() {
    if (this.questionPollingTimer) {
      clearInterval(this.questionPollingTimer);
    }
    console.log("[studentQuestion] clearQuestionPolling");
    this.questionPollingTimer = null;
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
      await this.refreshQuestionPageState();
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
      await this.refreshQuestionPageState();
      this.startQuestionPolling();
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
    this.refreshQuestionPageState();
    this.startQuestionPolling();
  },

  onHide() {
    this.clearQuestionPolling();
  },

  onUnload() {
    this.clearQuestionPolling();
  },

  async onPullDownRefresh() {
    try {
      await this.refreshQuestionPageState();
    } finally {
      wx.stopPullDownRefresh();
    }
  }
});
