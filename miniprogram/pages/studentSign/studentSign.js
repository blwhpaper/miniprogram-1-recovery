const db = wx.cloud.database()
const _ = db.command

Page({
  data: {
    lessonId: "",
    classId: "",
    name: "",
    studentId: "",
    signSuccess: false,
    hasSubmittedLeave: false,
    entrySource: "",
    currentUser: null,
    shouldGoRegister: false,
    questionRequestCount: 0,
    hasPendingQuestionRequest: false
  },

  getPendingLessonId() {
    return String(wx.getStorageSync("pendingLessonId") || "").trim();
  },

  getLaunchEntryParams() {
    const app = getApp();
    const launchOptions = app && app.globalData
      ? app.globalData.launchEntryOptions || {}
      : {};
    const query = launchOptions.query || {};
    return {
      lessonId: String(query.lessonId || "").trim(),
      scene: String(query.scene || "").trim(),
      q: String(query.q || "").trim()
    };
  },

  isRegisterReturn(options = {}) {
    const directLessonId = String(options.lessonId || "").trim();
    return !directLessonId && !!this.getPendingLessonId();
  },

  buildRegisterUrl(options = {}, lessonId = "") {
    const finalLessonId = String(
      lessonId || this.data.lessonId || this.getPendingLessonId() || ""
    ).trim();
    const query = [];
    const scene = options.scene || "";
    const q = options.q || "";

    if (scene) query.push(`scene=${encodeURIComponent(scene)}`);
    if (q) query.push(`q=${encodeURIComponent(q)}`);
    if (finalLessonId) query.push(`lessonId=${encodeURIComponent(finalLessonId)}`);

    const url = `/pages/register/register${query.length ? `?${query.join("&")}` : ""}`;
    return url;
  },

  goRegister() {
    const lessonId = String(this.data.lessonId || "").trim();
    console.log("[studentSign] go register lessonId =", lessonId);

    if (!lessonId) {
      wx.showToast({ title: "请重新扫码老师二维码", icon: "none" });
      return;
    }

    const url = `/pages/register/register?lessonId=${encodeURIComponent(lessonId)}&scene=${encodeURIComponent(lessonId)}`;
    console.log("[studentSign] go register url", url);

    wx.navigateTo({
      url,
      fail: (err) => {
        console.error("[studentSign] go register failed", err);
        wx.showToast({ title: "未能打开绑定页面", icon: "none" });
      }
    });
  },

  parseLessonIdFromOptions(options = {}) {
    const safeDecode = (value = "") => {
      let result = String(value || "");
      for (let i = 0; i < 2; i++) {
        try {
          const decoded = decodeURIComponent(result);
          if (decoded === result) break;
          result = decoded;
        } catch (err) {
          break;
        }
      }
      return result;
    };

    const getLessonIdFromQuery = (value = "") => {
      const decodedValue = safeDecode(value).trim();
      if (!decodedValue) return "";

      const queryString = decodedValue.includes("?")
        ? decodedValue.split("?")[1]
        : decodedValue;

      const params = {};
      queryString.split("&").forEach((item) => {
        if (!item) return;

        const [rawKey = "", ...rest] = item.split("=");
        const key = safeDecode(rawKey);
        const paramValue = safeDecode(rest.join("="));
        params[key] = paramValue;
      });

      return params.lessonId || params.scene || "";
    };

    const directLessonId = safeDecode(options.lessonId || "").trim();
    if (directLessonId) {
      return directLessonId;
    }

    const scene = safeDecode(options.scene || "").trim();
    if (scene) {
      if (scene.includes("=") || scene.includes("&")) {
        return getLessonIdFromQuery(scene);
      }
      return scene;
    }

    const q = safeDecode(options.q || "").trim();
    if (q) {
      if (q.includes("lessonId=") || q.includes("scene=") || q.includes("?")) {
        return getLessonIdFromQuery(q);
      }
      return q;
    }

    return "";
  },

  async onLoad(options) {
    console.log("[studentSign] raw options", options);
    console.log("[studentSign] raw scene", options.scene);
    console.log("[studentSign] raw q", options.q);

    const launchEntryParams = this.getLaunchEntryParams();
    const mergedOptions = {
      ...launchEntryParams,
      ...options
    };
    console.log("[studentSign] launch entry params", launchEntryParams);

    const hasRawEntryParams = !!String(
      mergedOptions.lessonId || mergedOptions.scene || mergedOptions.q || ""
    ).trim();
    const parsedLessonId = this.parseLessonIdFromOptions(mergedOptions);
    const pendingLessonId = this.getPendingLessonId();
    const entrySource = this.isRegisterReturn(mergedOptions) ? "register_return" : "scan_entry";
    const finalLessonId = parsedLessonId || (entrySource === "register_return" ? pendingLessonId : "");
    console.log("[studentSign] lesson source", {
      parsedLessonId,
      pendingLessonId,
      finalLessonId,
      entrySource
    });
    console.log("[studentSign] current page lessonId =", finalLessonId);
    console.log("[studentSign] restored lessonId =", {
      source: parsedLessonId ? "page_options" : (entrySource === "register_return" ? "pendingLessonId" : "none"),
      lessonId: finalLessonId
    });

    if (parsedLessonId) {
      wx.setStorageSync("pendingLessonId", parsedLessonId);
    } else if (finalLessonId) {
      wx.setStorageSync("pendingLessonId", finalLessonId);
    }

    if (!finalLessonId) {
      const message = !hasRawEntryParams
        ? "当前进入方式未携带签到参数，请重新扫码老师二维码"
        : "无效签到码，请重新扫码老师二维码";
      wx.showModal({
        title: "进入失败",
        content: message,
        showCancel: false
      });
      return;
    }

    wx.showLoading({ title: "加载中...", mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: "getMyUser"
      });

      wx.hideLoading();

      const result = res.result || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || "身份校验失败", icon: "none" });
        return;
      }

      const currentUser = result.user || {};
      const hasName = !!String(currentUser.name || "").trim();
      const hasStudentId = !!String(currentUser.studentId || "").trim();
      const shouldGoRegister = !result.bound || !hasName || !hasStudentId;
      console.log("[studentSign] current user =", currentUser);
      console.log("[studentSign] should go register =", {
        bound: !!result.bound,
        hasName,
        hasStudentId,
        shouldGoRegister
      });

      wx.setStorageSync("currentUser", currentUser);

      this.setData({
        lessonId: finalLessonId,
        classId: currentUser.classId || "",
        studentId: currentUser.studentId || "",
        hasSubmittedLeave: false,
        signSuccess: false,
        name: currentUser.name || "",
        entrySource,
        currentUser,
        shouldGoRegister
      });

      if (shouldGoRegister) {
        this.goRegister();
        return;
      }

      await this.ensureLessonClassId();
      await this.restoreSignSuccessStatus();
      await this.loadQuestionRequestState();
    } catch (err) {
      wx.hideLoading();
      console.error("getMyUser failed:", err);
      wx.showToast({ title: "服务请求失败", icon: "none" });
    }
  },

  onShow() {
    const pendingLessonId = this.getPendingLessonId();
    if (!this.data.lessonId && pendingLessonId) {
      this.setData({ lessonId: pendingLessonId });
      console.log("[studentSign] register return restored lessonId =", pendingLessonId);
    }
    if (this.data.lessonId && this.data.studentId) {
      this.ensureLessonClassId();
      this.restoreSignSuccessStatus();
      this.loadQuestionRequestState();
    }
  },

  async restoreSignSuccessStatus() {
    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();

    if (!lessonId || !studentId) {
      this.setData({ signSuccess: false });
      return false;
    }

    try {
      const res = await db.collection("attendance")
        .where({
          lessonId,
          studentId
        })
        .limit(1)
        .get();
      const hasSigned = Array.isArray(res.data) && res.data.length > 0;
      this.setData({ signSuccess: hasSigned });
      return hasSigned;
    } catch (err) {
      console.error("[studentSign] restoreSignSuccessStatus failed", err);
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
      console.error("[studentSign] ensureLessonClassId failed", err);
    }

    if (!studentId) return "";

    try {
      const attendanceRes = await db.collection("attendance")
        .where({
          lessonId,
          studentId
        })
        .limit(1)
        .get();
      const attendanceClassId = String(attendanceRes.data?.[0]?.classId || "").trim();
      if (attendanceClassId) {
        this.setData({ classId: attendanceClassId });
        return attendanceClassId;
      }
    } catch (err) {
      console.error("[studentSign] ensureLessonClassId fallback failed", err);
    }

    return "";
  },

  async loadQuestionRequestState() {
    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();
    const studentKey = this.getQuestionStudentKey();

    if (!lessonId || !studentKey || !studentId) {
      this.setData({
        questionRequestCount: 0,
        hasPendingQuestionRequest: false
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

      this.setData({
        questionRequestCount: requestIds.size,
        hasPendingQuestionRequest
      });
    } catch (err) {
      console.error("[studentSign] loadQuestionRequestState failed", err);
    }
  },

  async submitQuestionRequest() {
    const storedUser = wx.getStorageSync("currentUser") || {};
    const currentUser = this.data.currentUser || storedUser || {};
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

    this.setData({
      lessonId,
      studentId,
      name: studentName,
      classId,
      currentUser
    });

    console.log("[studentSign] submitQuestionRequest payload check", {
      lessonId,
      classId,
      studentId,
      studentName,
      signSuccess: this.data.signSuccess,
      data: this.data
    });

    if (!this.data.signSuccess) {
      wx.showToast({ title: "签到后才能申请提问", icon: "none" });
      return;
    }

    const missingFields = [];
    if (!lessonId) missingFields.push("lessonId");
    if (!classId) missingFields.push("classId");
    if (!studentId) missingFields.push("studentId");
    if (!studentName) missingFields.push("studentName");

    if (missingFields.length > 0) {
      wx.showToast({
        title: `缺少 ${missingFields.join("/")}`,
        icon: "none"
      });
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
      console.error("[studentSign] submitQuestionRequest failed", err);
      wx.showToast({ title: "申请失败，请稍后重试", icon: "none" });
    }
  },

  async submitSign() {
    const { name, studentId, lessonId } = this.data;

    if (!name || !studentId) {
      wx.showToast({ title: "未获取到绑定学生信息", icon: "none" });
      return;
    }

    if (!lessonId) {
      wx.showToast({ title: "无效签到码，请重新扫码", icon: "none" });
      return;
    }

    wx.showLoading({ title: "签到中...", mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: "submitSign",
        data: { 
          lessonId: lessonId,
          studentName: name
        }
      });

      wx.hideLoading();

      if (res.result && res.result.success) {
        this.setData({ signSuccess: true });
        wx.removeStorageSync("pendingLessonId");
        await this.ensureLessonClassId();
        await this.loadQuestionRequestState();
        wx.showToast({ title: "签到成功", icon: "success" });
      } else {
        wx.showModal({
          title: "签到失败",
          content: res.result && res.result.msg ? res.result.msg : "请稍后重试",
          showCancel: false
        });
      }

    } catch (err) {
      wx.hideLoading();
      console.error("签到异常：", err);
      wx.showToast({ title: "服务请求失败", icon: "none" });
    }
  },

  applyLeave() {
    const { name, studentId } = this.data;
    if (!name || !studentId) {
      wx.showToast({ title: "未获取到绑定学生信息", icon: "none" });
      return;
    }

    wx.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      success: (res) => {
        wx.showLoading({ title: "正在上传..." });
        
        // 建议：此处应使用 wx.cloud.uploadFile 上传假条图片并写入 leave_requests 集合
        // 这里为了演示流程，仅做状态提示
        setTimeout(() => {
          wx.hideLoading();
          this.setData({ hasSubmittedLeave: true });
          wx.showToast({ title: `${name}假条提交成功` });
        }, 800);
      }
    });
  },

  // 退出登录
  logout() {
    wx.clearStorageSync();
    wx.showToast({ title: "已退出绑定", icon: "none" });
    wx.redirectTo({ url: "/pages/login/login" });
  }

});
