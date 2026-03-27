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
    registerTipText: "当前还没有可用学生身份，请先绑定后再参加本次签到",
    hasBoundStudentSession: false,
    attendanceStatus: "unsigned",
    attendanceStatusText: "未签到",
    canInteract: false,
    leaveRequestTargetName: "",
    leaveRequestImageTempPath: "",
    leaveRequestImageFileId: "",
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

  getAttendanceStatusLabel(status = "") {
    const normalizedStatus = String(status || "").trim();
    const map = {
      signed: "已签到",
      unsigned: "未签到",
      absent: "旷课",
      leave_wait: "待审批",
      leave_agree: "请假"
    };
    return map[normalizedStatus || "unsigned"] || "未签到";
  },

  getLeaveRequestCloudPath(tempFilePath = "") {
    const extensionMatch = String(tempFilePath || "").match(/\.([^.\/?#]+)(?:[?#].*)?$/);
    const extension = extensionMatch ? extensionMatch[1] : "jpg";
    const lessonId = this.resolveLessonId() || "lesson";
    const studentId = String(this.data.studentId || "").trim() || "student";
    return `leave-request/${lessonId}/${studentId}_${Date.now()}.${extension}`;
  },

  getPendingLessonId() {
    return String(wx.getStorageSync("pendingLessonId") || "").trim();
  },

  resolveLessonId() {
    return String(this.data.lessonId || this.getPendingLessonId() || "").trim();
  },

  async resolveLessonContext() {
    const lessonId = this.resolveLessonId();
    const studentId = String(this.data.studentId || "").trim();
    const studentName = String(this.data.name || "").trim();
    let classId = String(this.data.classId || "").trim();

    if (!classId && lessonId) {
      classId = String((await this.ensureLessonClassId()) || "").trim();
    }

    if (lessonId && lessonId !== String(this.data.lessonId || "").trim()) {
      this.setData({ lessonId });
    }

    return {
      lessonId,
      classId,
      studentId,
      studentName
    };
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
    const lessonId = this.resolveLessonId();

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
        attendanceStatus: "unsigned",
        attendanceStatusText: "未签到",
        leaveRequestTargetName: "",
        leaveRequestImageTempPath: "",
        leaveRequestImageFileId: "",
        name: currentUser.name || "",
        currentUser,
        shouldGoRegister,
        registerTipText: shouldGoRegister
          ? "当前还没有可用学生身份，请先绑定后再参加本次签到"
          : "",
        hasBoundStudentSession: !shouldGoRegister && !!currentUser && hasName && hasStudentId,
        canInteract: false
      });

      if (shouldGoRegister) {
        this.goRegister();
        return;
      }

      await this.ensureLessonClassId();
      await this.restoreSignSuccessStatus();
      await this.loadCurrentSingleChoiceTest();
      this.startTestPolling();
    } catch (err) {
      wx.hideLoading();
      console.error("getMyUser failed:", err);
      wx.showToast({ title: "服务请求失败", icon: "none" });
    }
  },

  async onShow() {
    const lessonId = this.resolveLessonId();
    if (!this.data.lessonId && lessonId) {
      this.setData({ lessonId });
    }
    if (lessonId && this.data.studentId) {
      await this.ensureLessonClassId();
      await this.restoreSignSuccessStatus();
      await this.loadCurrentSingleChoiceTest();
      this.startTestPolling();
    }
  },

  onHide() {
    this.clearTestPolling();
  },

  onUnload() {
    this.clearTestPolling();
  },

  async restoreSignSuccessStatus() {
    const lessonId = this.resolveLessonId();
    const studentId = String(this.data.studentId || "").trim();

    if (!lessonId || !studentId) {
      this.setData({
        signSuccess: false,
        attendanceStatus: "unsigned",
        attendanceStatusText: "未签到",
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
      const attendanceDoc = Array.isArray(res.data) ? res.data[0] || null : null;
      const attendanceStatus = String(
        attendanceDoc?.status ||
        attendanceDoc?.attendanceStatus ||
        "unsigned"
      ).trim() || "unsigned";
      const hasSigned = attendanceStatus === "signed";
      this.setData({
        signSuccess: hasSigned,
        attendanceStatus,
        attendanceStatusText: this.getAttendanceStatusLabel(attendanceStatus),
        canInteract: this.getCanInteract({ signSuccess: hasSigned })
      });
      return hasSigned;
    } catch (err) {
      console.error("[studentSign] restoreSignSuccessStatus failed", err);
      return false;
    }
  },

  async saveCurrentAttendanceStatus(nextStatus = "") {
    const { lessonId, classId, studentId, studentName } = await this.resolveLessonContext();
    const status = String(nextStatus || "").trim();

    if (!lessonId || !classId || !studentId || !studentName || !status) {
      wx.showToast({ title: "当前课堂信息不完整", icon: "none" });
      return false;
    }

    try {
      const existedRes = await db.collection("attendance")
        .where({
          lessonId,
          studentId
        })
        .limit(1)
        .get();
      const existed = Array.isArray(existedRes.data) ? existedRes.data[0] || null : null;
      const payload = {
        lessonId,
        classId,
        studentId,
        studentName,
        status,
        attendanceStatus: status,
        updatedAt: db.serverDate()
      };

      if (existed && existed._id) {
        await db.collection("attendance").doc(existed._id).update({
          data: payload
        });
      } else {
        await db.collection("attendance").add({
          data: payload
        });
      }

      return true;
    } catch (err) {
      console.error("[studentSign] saveCurrentAttendanceStatus failed", err);
      wx.showToast({ title: "请假状态提交失败", icon: "none" });
      return false;
    }
  },

  async chooseLeaveRequestImage() {
    if (!this.ensureBoundStudentSession("请假申请")) {
      return;
    }

    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"]
      });
      const tempFilePath = String(res.tempFiles?.[0]?.tempFilePath || "").trim();
      if (!tempFilePath) return;
      this.setData({
        leaveRequestImageTempPath: tempFilePath
      });
    } catch (err) {
      if (err?.errMsg && err.errMsg.includes("cancel")) return;
      console.error("[studentSign] chooseLeaveRequestImage failed", err);
      wx.showToast({ title: "选择假条失败", icon: "none" });
    }
  },

  onInputLeaveRequestTargetName(e) {
    this.setData({
      leaveRequestTargetName: String(e.detail?.value || "").trim()
    });
  },

  async submitLeaveRequest() {
    if (!this.ensureBoundStudentSession("请假申请")) {
      return;
    }

    if (!this.data.signSuccess) {
      wx.showToast({ title: "请先签到后再申请请假", icon: "none" });
      return;
    }

    if (this.data.attendanceStatus === "leave_agree") {
      wx.showToast({ title: "当前已请假", icon: "none" });
      return;
    }

    if (this.data.attendanceStatus === "absent") {
      wx.showToast({ title: "当前已被标记为旷课", icon: "none" });
      return;
    }

    const tempFilePath = String(this.data.leaveRequestImageTempPath || "").trim();
    if (!tempFilePath) {
      wx.showToast({ title: "请先上传假条图片", icon: "none" });
      return;
    }

    const applicantStudentId = String(this.data.studentId || "").trim();
    const applicantStudentName = String(this.data.name || "").trim();
    const requestedStudentNameInput = String(this.data.leaveRequestTargetName || "").trim();

    if (!requestedStudentNameInput) {
      wx.showToast({ title: "请填写请假人姓名", icon: "none" });
      return;
    }

    const { lessonId, classId } = await this.resolveLessonContext();

    if (!lessonId || !classId || !applicantStudentId || !applicantStudentName) {
      wx.showToast({ title: "当前课堂信息不完整", icon: "none" });
      return;
    }

    try {
      const classRes = await db.collection("classes").doc(classId).get();
      const roster = Array.isArray(classRes.data?.roster) ? classRes.data.roster : [];
      const matchedStudents = roster.filter((item) => {
        const rosterName = String(item?.name || "").trim();
        return rosterName === requestedStudentNameInput;
      });

      if (matchedStudents.length === 0) {
        wx.showToast({ title: "当前学生不在班级名单中", icon: "none" });
        return;
      }

      if (matchedStudents.length > 1) {
        wx.showToast({ title: "班级中存在同名学生，请联系老师处理", icon: "none" });
        return;
      }

      const matchedStudent = matchedStudents[0] || {};
      const requestedStudentId = String(
        matchedStudent?.studentId || matchedStudent?.id || ""
      ).trim();
      const requestedStudentName = String(
        matchedStudent?.name || requestedStudentNameInput
      ).trim();

      if (!requestedStudentId || !requestedStudentName) {
        wx.showToast({ title: "请假学生信息不完整", icon: "none" });
        return;
      }

      if (requestedStudentId === applicantStudentId) {
        wx.showToast({ title: "不能为当前已签到学生本人申请请假", icon: "none" });
        return;
      }

      const attendanceRes = await db.collection("attendance")
        .where({
          lessonId,
          studentId: requestedStudentId
        })
        .limit(1)
        .get();
      const currentAttendance = Array.isArray(attendanceRes.data) ? attendanceRes.data[0] || null : null;
      const currentAttendanceStatus = String(
        currentAttendance?.status ||
        currentAttendance?.attendanceStatus ||
        "unsigned"
      ).trim() || "unsigned";

      if (currentAttendanceStatus === "leave_agree") {
        wx.showToast({ title: "该学生当前已请假", icon: "none" });
        return;
      }

      if (currentAttendanceStatus === "absent") {
        wx.showToast({ title: "该学生当前已被标记为旷课", icon: "none" });
        return;
      }

      wx.showLoading({ title: "提交中...", mask: true });
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: this.getLeaveRequestCloudPath(tempFilePath),
        filePath: tempFilePath
      });
      const imageFileId = String(uploadRes.fileID || "").trim();
      if (!imageFileId) {
        wx.hideLoading();
        wx.showToast({ title: "假条上传失败", icon: "none" });
        return;
      }

      const existedRes = await db.collection("lessonEvent")
        .where({
          lessonId,
          studentId: requestedStudentId,
          type: "leave_request"
        })
        .get();
      const existedPending = (existedRes.data || []).find(
        (item) => String(item.payload?.status || "").trim() === "pending"
      );

      const payload = {
        status: "pending",
        imageFileId,
        applicantStudentId,
        applicantStudentName,
        requestedStudentId,
        requestedStudentName,
        submittedAt: db.serverDate()
      };

      if (existedPending && existedPending._id) {
        await db.collection("lessonEvent").doc(existedPending._id).update({
          data: {
            payload,
            updatedAt: db.serverDate()
          }
        });
      } else {
        await db.collection("lessonEvent").add({
          data: {
            lessonId,
            classId,
            studentId: requestedStudentId,
            studentName: requestedStudentName,
            type: "leave_request",
            score: 0,
            round: 0,
            payload,
            createdAt: db.serverDate(),
            createdBy: "student"
          }
        });
      }

      wx.hideLoading();
      this.setData({
        leaveRequestTargetName: "",
        leaveRequestImageTempPath: "",
        leaveRequestImageFileId: imageFileId
      });
      wx.showToast({
        title: `已为${requestedStudentName}提交请假申请`,
        icon: "none"
      });
    } catch (err) {
      wx.hideLoading();
      console.error("[studentSign] submitLeaveRequest failed", err);
      wx.showToast({ title: "请假申请失败，请稍后重试", icon: "none" });
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
    const lessonId = this.resolveLessonId();
    const studentId = String(this.data.studentId || "").trim();
    if (this.data.classId) {
      if (lessonId && lessonId !== String(this.data.lessonId || "").trim()) {
        this.setData({ lessonId });
      }
      return String(this.data.classId || "").trim();
    }

    if (!lessonId) return "";

    try {
      const res = await db.collection("lessons").doc(lessonId).get();
      const lessonClassId = String(res.data?.classId || "").trim();
      if (lessonClassId) {
        this.setData({
          lessonId,
          classId: lessonClassId
        });
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
        this.setData({
          lessonId,
          classId: attendanceClassId
        });
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
    const lessonId = this.resolveLessonId();
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
    const lessonId = this.resolveLessonId();
    const studentId = String(this.data.studentId || "").trim();
    if (!lessonId || !studentId) return;

    this.clearTestPolling();
    this.testPollingTimer = setInterval(() => {
      this.restoreSignSuccessStatus()
        .then(() => this.loadCurrentSingleChoiceTest())
        .catch((err) => {
          console.error("[studentSign] polling refresh failed", err);
        });
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
    const name = String(this.data.name || "").trim();
    const studentId = String(this.data.studentId || "").trim();
    const lessonId = this.resolveLessonId();

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
        wx.setStorageSync("pendingLessonId", lessonId);
        await this.ensureLessonClassId();
        await this.restoreSignSuccessStatus();
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
      attendanceStatus: "unsigned",
      attendanceStatusText: "未签到",
      leaveRequestTargetName: "",
      leaveRequestImageTempPath: "",
      leaveRequestImageFileId: "",
      currentUser: null,
      shouldGoRegister: true,
      registerTipText: "你已退出当前学生身份，请重新绑定后再继续签到或互动",
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
