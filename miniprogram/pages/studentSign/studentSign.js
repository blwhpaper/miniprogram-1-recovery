const db = wx.cloud.database()
const _ = db.command

Page({
  data: {
    lessonId: "",
    classId: "",
    name: "",
    studentId: "",
    signSuccess: false,
    currentUser: null,
    shouldGoRegister: false,
    hasBoundStudentSession: false,
    canInteract: false,
    questionRequestCount: 0,
    hasPendingQuestionRequest: false,
    currentSingleChoiceTest: null,
    selectedSingleChoiceAnswer: "",
    hasSubmittedCurrentTest: false,
    currentTestRecord: null
  },

  testPollingTimer: null,

  getHasBoundStudentSession(state = {}) {
    const currentUser = state.currentUser !== undefined ? state.currentUser : this.data.currentUser;
    const shouldGoRegister = state.shouldGoRegister !== undefined ? state.shouldGoRegister : this.data.shouldGoRegister;
    const name = state.name !== undefined ? state.name : this.data.name;
    const studentId = state.studentId !== undefined ? state.studentId : this.data.studentId;

    return Boolean(
      currentUser &&
      !shouldGoRegister &&
      String(name || "").trim() &&
      String(studentId || "").trim()
    );
  },

  getCanInteract(state = {}) {
    const hasBoundStudentSession = state.hasBoundStudentSession !== undefined
      ? state.hasBoundStudentSession
      : this.getHasBoundStudentSession(state);
    const signSuccess = state.signSuccess !== undefined ? state.signSuccess : this.data.signSuccess;
    return Boolean(hasBoundStudentSession && signSuccess);
  },

  ensureBoundStudentSession(actionLabel = "当前操作") {
    if (this.getHasBoundStudentSession()) return true;
    wx.showToast({ title: `请先绑定后再${actionLabel}`, icon: "none" });
    return false;
  },

  ensureInteractionAllowed(actionLabel = "互动") {
    if (this.getCanInteract()) return true;
    wx.showToast({ title: `请先完成签到后再${actionLabel}`, icon: "none" });
    return false;
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

  goRegister() {
    const lessonId = String(this.data.lessonId || "").trim();

    if (!lessonId) {
      wx.showToast({ title: "请重新扫码老师二维码", icon: "none" });
      return;
    }

    const url = `/pages/register/register?lessonId=${encodeURIComponent(lessonId)}&scene=${encodeURIComponent(lessonId)}`;

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
    const launchEntryParams = this.getLaunchEntryParams();
    const mergedOptions = {
      ...launchEntryParams,
      ...options
    };

    const hasRawEntryParams = !!String(
      mergedOptions.lessonId || mergedOptions.scene || mergedOptions.q || ""
    ).trim();
    const parsedLessonId = this.parseLessonIdFromOptions(mergedOptions);
    const pendingLessonId = this.getPendingLessonId();
    const isRegisterReturn = this.isRegisterReturn(mergedOptions);
    const finalLessonId = parsedLessonId || (isRegisterReturn ? pendingLessonId : "");

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

      wx.setStorageSync("currentUser", currentUser);

      this.setData({
        lessonId: finalLessonId,
        classId: currentUser.classId || "",
        studentId: currentUser.studentId || "",
        signSuccess: false,
        name: currentUser.name || "",
        currentUser,
        shouldGoRegister,
        hasBoundStudentSession: !shouldGoRegister && !!currentUser && hasName && hasStudentId,
        canInteract: false
      });

      if (shouldGoRegister) {
        this.goRegister();
        return;
      }

      await this.ensureLessonClassId();
      const hasSigned = await this.restoreSignSuccessStatus();
      await this.loadQuestionRequestState();
      await this.loadCurrentSingleChoiceTest();
      if (hasSigned) {
        this.startTestPolling();
      }
    } catch (err) {
      wx.hideLoading();
      console.error("getMyUser failed:", err);
      wx.showToast({ title: "服务请求失败", icon: "none" });
    }
  },

  async onShow() {
    const pendingLessonId = this.getPendingLessonId();
    if (!this.data.lessonId && pendingLessonId) {
      this.setData({ lessonId: pendingLessonId });
    }
    if (this.data.lessonId && this.data.studentId) {
      await this.ensureLessonClassId();
      const hasSigned = await this.restoreSignSuccessStatus();
      await this.loadQuestionRequestState();
      await this.loadCurrentSingleChoiceTest();
      if (hasSigned) {
        this.startTestPolling();
      } else {
        this.clearTestPolling();
      }
    }
  },

  onHide() {
    this.clearTestPolling();
  },

  onUnload() {
    this.clearTestPolling();
  },

  async restoreSignSuccessStatus() {
    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();

    if (!lessonId || !studentId) {
      this.setData({
        signSuccess: false,
        canInteract: false
      });
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
      this.setData({
        signSuccess: hasSigned,
        canInteract: this.getCanInteract({ signSuccess: hasSigned })
      });
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

  normalizeSingleChoicePublish(item = {}) {
    const payload = item.payload || {};
    const options = Array.isArray(payload.options)
      ? payload.options
        .map((option) => String(option || "").trim())
        .filter(Boolean)
        .map((option) => {
          const matched = option.match(/^([A-Z])[\.\uff0e]\s*(.*)$/i);
          return {
            value: matched ? String(matched[1] || "").toUpperCase() : option,
            text: option
          };
        })
      : [];

    return {
      _id: String(item._id || "").trim(),
      lessonId: String(item.lessonId || "").trim(),
      classId: String(item.classId || "").trim(),
      testType: String(payload.testType || "").trim(),
      testSubType: String(payload.testSubType || "").trim(),
      testContent: String(payload.content || "").trim(),
      testStatus: String(payload.status || "").trim(),
      testOptions: options,
      testCorrectAnswer: String(payload.correctAnswer || "").trim()
    };
  },

  async loadCurrentSingleChoiceTest() {
    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();

    if (!lessonId || !studentId || !this.data.signSuccess) {
      this.setData({
        currentSingleChoiceTest: null,
        selectedSingleChoiceAnswer: "",
        hasSubmittedCurrentTest: false,
        currentTestRecord: null
      });
      return null;
    }

    try {
      const publishRes = await db.collection("lessonEvent")
        .where({
          lessonId,
          type: "test_publish"
        })
        .orderBy("createdAt", "desc")
        .get();
      const publishedList = (publishRes.data || [])
        .map((item) => this.normalizeSingleChoicePublish(item))
        .filter((item) => item.testType === "single_choice" && item.testStatus === "published");
      const currentSingleChoiceTest = publishedList[0] || null;

      if (!currentSingleChoiceTest) {
        this.setData({
          currentSingleChoiceTest: null,
          selectedSingleChoiceAnswer: "",
          hasSubmittedCurrentTest: false,
          currentTestRecord: null
        });
        return null;
      }

      const questionId = String(currentSingleChoiceTest._id || "").trim();
      const recordRes = await db.collection("lessonEvent")
        .where({
          lessonId,
          studentId,
          type: "test_record",
          "payload.questionId": questionId
        })
        .limit(1)
        .get();
      const currentTestRecord = recordRes.data?.[0] || null;

      this.setData({
        currentSingleChoiceTest,
        selectedSingleChoiceAnswer: String(currentTestRecord?.payload?.answer || "").trim(),
        hasSubmittedCurrentTest: !!currentTestRecord,
        currentTestRecord
      });
      return currentSingleChoiceTest;
    } catch (err) {
      console.error("[studentSign] loadCurrentSingleChoiceTest failed", err);
      return null;
    }
  },

  startTestPolling() {
    const lessonId = String(this.data.lessonId || "").trim();
    if (!lessonId || !this.data.signSuccess) return;

    this.clearTestPolling();
    this.testPollingTimer = setInterval(() => {
      this.loadCurrentSingleChoiceTest();
    }, 5000);
  },

  clearTestPolling() {
    if (this.testPollingTimer) {
      clearInterval(this.testPollingTimer);
    }
    this.testPollingTimer = null;
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

  onSelectSingleChoiceAnswer(e) {
    if (!this.getCanInteract()) return;
    const answer = String(e.currentTarget.dataset.answer || "").trim();
    if (!answer || this.data.hasSubmittedCurrentTest) return;
    this.setData({ selectedSingleChoiceAnswer: answer });
  },

  async submitSingleChoiceAnswer() {
    if (!this.ensureInteractionAllowed("作答")) {
      return;
    }

    const lessonId = String(this.data.lessonId || "").trim();
    const studentId = String(this.data.studentId || "").trim();
    const studentName = String(this.data.name || "").trim();
    const classId = String((await this.ensureLessonClassId()) || this.data.classId || "").trim();
    const currentTest = this.data.currentSingleChoiceTest || null;
    const questionId = String(currentTest?._id || "").trim();
    const selectedAnswer = String(this.data.selectedSingleChoiceAnswer || "").trim();

    if (!questionId || !currentTest) {
      wx.showToast({ title: "当前没有可作答单选题", icon: "none" });
      return;
    }

    if (!selectedAnswer) {
      wx.showToast({ title: "请先选择答案", icon: "none" });
      return;
    }

    if (this.data.hasSubmittedCurrentTest) {
      wx.showToast({ title: "当前题目已提交", icon: "none" });
      return;
    }

    try {
      const existedRes = await db.collection("lessonEvent")
        .where({
          lessonId,
          studentId,
          type: "test_record",
          "payload.questionId": questionId
        })
        .limit(1)
        .get();
      if (Array.isArray(existedRes.data) && existedRes.data.length > 0) {
        this.setData({
          hasSubmittedCurrentTest: true,
          currentTestRecord: existedRes.data[0],
          selectedSingleChoiceAnswer: String(existedRes.data[0]?.payload?.answer || "").trim()
        });
        wx.showToast({ title: "当前题目已提交", icon: "none" });
        return;
      }

      const correctAnswer = String(currentTest.testCorrectAnswer || "").trim();
      const isCorrect = !!selectedAnswer && selectedAnswer === correctAnswer;

      await db.collection("lessonEvent").add({
        data: {
          lessonId,
          classId,
          studentId,
          studentName,
          type: "test_record",
          score: isCorrect ? 100 : 0,
          round: 0,
          payload: {
            testType: "single_choice",
            testSubType: String(currentTest.testSubType || "").trim(),
            questionId,
            options: Array.isArray(currentTest.testOptions)
              ? currentTest.testOptions.map((item) => item.text)
              : [],
            correctAnswer,
            result: isCorrect ? "correct" : "wrong",
            content: String(currentTest.testContent || "").trim(),
            answer: selectedAnswer,
            status: "submitted"
          },
          createdAt: db.serverDate(),
          createdBy: "student"
        }
      });

      await this.loadCurrentSingleChoiceTest();
      wx.showToast({ title: "答案已提交", icon: "none" });
    } catch (err) {
      console.error("[studentSign] submitSingleChoiceAnswer failed", err);
      wx.showToast({ title: "提交失败，请稍后重试", icon: "none" });
    }
  },

  async submitSign() {
    const { name, studentId, lessonId } = this.data;

    if (!this.ensureBoundStudentSession("签到")) {
      return;
    }

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
        this.setData({
          signSuccess: true,
          canInteract: this.getCanInteract({ signSuccess: true })
        });
        wx.removeStorageSync("pendingLessonId");
        await this.ensureLessonClassId();
        await this.loadQuestionRequestState();
        await this.loadCurrentSingleChoiceTest();
        this.startTestPolling();
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

  resetStudentSessionState() {
    this.clearTestPolling();
    this.setData({
      classId: "",
      name: "",
      studentId: "",
      signSuccess: false,
      currentUser: null,
      shouldGoRegister: true,
      hasBoundStudentSession: false,
      canInteract: false,
      questionRequestCount: 0,
      hasPendingQuestionRequest: false,
      currentSingleChoiceTest: null,
      selectedSingleChoiceAnswer: "",
      hasSubmittedCurrentTest: false,
      currentTestRecord: null
    });
  },

  // 退出登录
  logout() {
    const lessonId = String(this.data.lessonId || this.getPendingLessonId() || "").trim();

    wx.removeStorageSync("currentUser");
    if (lessonId) {
      wx.setStorageSync("pendingLessonId", lessonId);
    }

    this.resetStudentSessionState();
    wx.showToast({ title: "已退出当前学生身份", icon: "none" });
  }

});
