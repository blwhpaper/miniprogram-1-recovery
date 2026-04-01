const db = wx.cloud.database()
const _ = db.command

Page({
  data: {
    lessonId: "",
    classId: "",
    classRoster: [],
    entryMode: "",
    isLeaveResultView: false,
    name: "",
    studentId: "",
    signSuccess: false,
    currentUser: null,
    shouldGoRegister: false,
    registerTipText: "先绑定学生身份",
    hasBoundStudentSession: false,
    attendanceStatus: "unsigned",
    attendanceStatusText: "未签到",
    canInteract: false,
    leaveRequestTargetName: "",
    leaveRequestTargetStatus: "empty",
    leaveRequestTargetStatusText: "先填姓名",
    leaveRequestMatchedStudentId: "",
    leaveRequestMatchedStudentName: "",
    leaveRequestImageTempPath: "",
    leaveRequestImageFileId: "",
    leaveRequestSubmitting: false,
    canSubmitLeaveRequest: false,
    leaveRequestLastSubmittedEventId: "",
    leaveRequestLastSubmittedName: "",
    leaveRequestLastSubmittedStatus: "",
    leaveRequestLastSubmittedStatusText: "",
    leaveRequestLastSubmittedTimeText: "",
    leaveRequestLastSubmittedTitle: "",
    ownLeaveResultStatus: "",
    ownLeaveResultStatusText: "",
    ownLeaveResultTimeText: "",
    ownLeaveResultApplicantName: "",
    ownLeaveResultApplicantId: "",
    ownLeaveResultTargetId: "",
    ownLeaveResultTargetName: "",
    ownLeaveResultTipText: "",
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
      leave_agree: "已请假"
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

  getLeaveRequestStatusLabel(status = "") {
    const normalizedStatus = String(status || "").trim() || "pending";
    const map = {
      pending: "已提交",
      approved: "已确认",
      closed: "已关闭"
    };
    return map[normalizedStatus] || "已提交";
  },

  getOwnLeaveResultStatusText(attendanceStatus = "", requestStatus = "") {
    const normalizedAttendanceStatus = String(attendanceStatus || "").trim();
    const normalizedRequestStatus = String(requestStatus || "").trim();

    if (normalizedAttendanceStatus === "leave_agree" || normalizedRequestStatus === "approved") {
      return "已请假";
    }

    if (normalizedRequestStatus === "pending") {
      return "待审批";
    }

    if (normalizedRequestStatus === "closed") {
      return "已关闭";
    }

    return "";
  },

  formatSimpleDateTime(value) {
    const rawValue = value && typeof value.toDate === "function" ? value.toDate() : value;
    const date = rawValue instanceof Date ? rawValue : new Date(rawValue);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }

    const pad = (num) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  getLeaveRequestEventTimestamp(item = {}) {
    const payload = item?.payload || {};
    const candidateList = [payload.submittedAt, item.updatedAt, item.createdAt];

    for (let i = 0; i < candidateList.length; i += 1) {
      const rawValue = candidateList[i];
      if (!rawValue) continue;

      if (typeof rawValue?.toDate === "function") {
        const date = rawValue.toDate();
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          return date.getTime();
        }
      }

      if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
        return rawValue.getTime();
      }

      const date = new Date(rawValue);
      if (!Number.isNaN(date.getTime())) {
        return date.getTime();
      }
    }

    return 0;
  },

  getPendingLessonId() {
    return String(wx.getStorageSync("pendingLessonId") || "").trim();
  },

  clearPendingLessonIdIfMatch(lessonId = "") {
    const normalizedLessonId = String(lessonId || "").trim();
    if (!normalizedLessonId) return;
    if (this.getPendingLessonId() !== normalizedLessonId) return;
    wx.removeStorageSync("pendingLessonId");
  },

  applyInvalidLeaveResultState(message = "当前课次已失效，暂时无法查看本课请假结果。") {
    this.clearTestPolling();
    this.setData({
      lessonId: "",
      classId: "",
      classRoster: [],
      signSuccess: false,
      attendanceStatus: "unsigned",
      attendanceStatusText: "未签到",
      canInteract: false,
      canSubmitLeaveRequest: false,
      leaveRequestLastSubmittedEventId: "",
      leaveRequestLastSubmittedName: "",
      leaveRequestLastSubmittedStatus: "",
      leaveRequestLastSubmittedStatusText: "",
      leaveRequestLastSubmittedTimeText: "",
      leaveRequestLastSubmittedTitle: "",
      ownLeaveResultStatus: "",
      ownLeaveResultStatusText: "",
      ownLeaveResultTimeText: "",
      ownLeaveResultApplicantName: String(this.data.name || "").trim(),
      ownLeaveResultApplicantId: String(this.data.studentId || "").trim(),
      ownLeaveResultTargetId: "",
      ownLeaveResultTargetName: "",
      ownLeaveResultTipText: message,
      currentSingleChoiceTest: null,
      selectedSingleChoiceAnswer: "",
      hasSubmittedCurrentTest: false,
      currentTestRecord: null
    });
  },

  async getReadableLesson(lessonId = "", logLabel = "") {
    const normalizedLessonId = String(lessonId || "").trim();
    if (!normalizedLessonId) return null;

    try {
      const lessonRes = await db.collection("lessons").doc(normalizedLessonId).get();
      return lessonRes.data || null;
    } catch (err) {
      console.warn(`[studentSign] ${logLabel || "getReadableLesson"} skip invalid lesson`, {
        lessonId: normalizedLessonId,
        err
      });
      this.clearPendingLessonIdIfMatch(normalizedLessonId);
      return null;
    }
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

  updateLeaveRequestTargetMatch(targetName = "") {
    const requestedStudentNameInput = String(targetName || "").trim();
    const classRoster = Array.isArray(this.data.classRoster) ? this.data.classRoster : [];
    const applicantStudentId = String(this.data.studentId || "").trim();

    if (!requestedStudentNameInput) {
      this.setData({
        leaveRequestTargetStatus: "empty",
        leaveRequestTargetStatusText: "先填写需请假的本班学生姓名",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "empty",
          leaveRequestMatchedStudentName: "",
          leaveRequestMatchedStudentId: ""
        })
      });
      return null;
    }

    if (classRoster.length === 0) {
      this.setData({
        leaveRequestTargetStatus: "idle",
        leaveRequestTargetStatusText: "班级名单加载中，请稍后",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "idle",
          leaveRequestMatchedStudentName: "",
          leaveRequestMatchedStudentId: ""
        })
      });
      return null;
    }

    const matchedStudents = classRoster.filter((item) => {
      const rosterName = String(item?.name || "").trim();
      return rosterName === requestedStudentNameInput;
    });

    if (matchedStudents.length === 0) {
      this.setData({
        leaveRequestTargetStatus: "not_found",
        leaveRequestTargetStatusText: "未匹配到该学生，请确认姓名是否与班级名单一致",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "not_found",
          leaveRequestMatchedStudentName: "",
          leaveRequestMatchedStudentId: ""
        })
      });
      return null;
    }

    if (matchedStudents.length > 1) {
      this.setData({
        leaveRequestTargetStatus: "duplicate",
        leaveRequestTargetStatusText: "同名学生过多",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "duplicate",
          leaveRequestMatchedStudentName: "",
          leaveRequestMatchedStudentId: ""
        })
      });
      return null;
    }

    const matchedStudent = matchedStudents[0] || {};
    const requestedStudentId = String(
      matchedStudent?.studentId || matchedStudent?.id || ""
    ).trim();
    const requestedStudentName = String(
      matchedStudent?.name || requestedStudentNameInput
    ).trim();

    if (!requestedStudentId || !requestedStudentName) {
      this.setData({
        leaveRequestTargetStatus: "invalid",
        leaveRequestTargetStatusText: "学生信息不完整",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "invalid",
          leaveRequestMatchedStudentName: "",
          leaveRequestMatchedStudentId: ""
        })
      });
      return null;
    }

    if (requestedStudentId === applicantStudentId) {
      this.setData({
        leaveRequestTargetStatus: "self",
        leaveRequestTargetStatusText: "不能给自己提交",
        leaveRequestMatchedStudentId: requestedStudentId,
        leaveRequestMatchedStudentName: requestedStudentName,
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "self",
          leaveRequestMatchedStudentName: requestedStudentName,
          leaveRequestMatchedStudentId: requestedStudentId
        })
      });
      return null;
    }

    this.setData({
      leaveRequestTargetStatus: "matched",
      leaveRequestTargetStatusText: `已匹配：${requestedStudentName}`,
      leaveRequestMatchedStudentId: requestedStudentId,
      leaveRequestMatchedStudentName: requestedStudentName,
      canSubmitLeaveRequest: this.canSubmitLeaveRequest({
        leaveRequestTargetStatus: "matched",
        leaveRequestMatchedStudentName: requestedStudentName,
        leaveRequestMatchedStudentId: requestedStudentId
      })
    });

    return {
      requestedStudentId,
      requestedStudentName
    };
  },

  canSubmitLeaveRequest(state = {}) {
    return Boolean(
      (state.signSuccess !== undefined ? state.signSuccess : this.data.signSuccess) &&
      (state.leaveRequestTargetStatus !== undefined ? state.leaveRequestTargetStatus : this.data.leaveRequestTargetStatus) === "matched" &&
      String(state.leaveRequestImageTempPath !== undefined ? state.leaveRequestImageTempPath : this.data.leaveRequestImageTempPath || "").trim() &&
      !(state.leaveRequestSubmitting !== undefined ? state.leaveRequestSubmitting : this.data.leaveRequestSubmitting)
    );
  },

  async loadClassRoster() {
    const classId = String(this.data.classId || "").trim();
    if (!classId) {
      this.setData({ classRoster: [] });
      this.updateLeaveRequestTargetMatch(this.data.leaveRequestTargetName);
      return [];
    }

    try {
      const classRes = await db.collection("classes").doc(classId).get();
      const roster = Array.isArray(classRes.data?.roster) ? classRes.data.roster : [];
      this.setData({ classRoster: roster });
      this.updateLeaveRequestTargetMatch(this.data.leaveRequestTargetName);
      return roster;
    } catch (err) {
      console.error("[studentSign] loadClassRoster failed", err);
      this.setData({ classRoster: [] });
      this.updateLeaveRequestTargetMatch(this.data.leaveRequestTargetName);
      return [];
    }
  },

  async loadLatestLeaveRequestSubmission(displayMode = "history") {
    const lessonId = this.resolveLessonId();
    const applicantStudentId = String(this.data.studentId || "").trim();

    if (!lessonId || !applicantStudentId) {
      this.setData({
        leaveRequestLastSubmittedEventId: "",
        leaveRequestLastSubmittedName: "",
        leaveRequestLastSubmittedStatus: "",
        leaveRequestLastSubmittedStatusText: "",
        leaveRequestLastSubmittedTimeText: "",
        leaveRequestLastSubmittedTitle: ""
      });
      return null;
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          lessonId,
          type: "leave_request"
        })
        .limit(100)
        .get();
      const matched = (res.data || [])
        .filter((item) => {
          const payload = item?.payload || {};
          return String(payload.applicantStudentId || "").trim() === applicantStudentId;
        })
        .sort((left, right) => this.getLeaveRequestEventTimestamp(right) - this.getLeaveRequestEventTimestamp(left))[0] || null;

      if (!matched) {
        this.setData({
          leaveRequestLastSubmittedEventId: "",
          leaveRequestLastSubmittedName: "",
          leaveRequestLastSubmittedStatus: "",
          leaveRequestLastSubmittedStatusText: "",
          leaveRequestLastSubmittedTimeText: "",
          leaveRequestLastSubmittedTitle: ""
        });
        return null;
      }

      const payload = matched.payload || {};
      const status = String(payload.status || "").trim() || "pending";
      const recordId = String(matched._id || "").trim();
      const nextTitle = displayMode === "current"
        ? "本次代提交已成功记录"
        : "历史最近一次代提交记录";
      this.setData({
        leaveRequestLastSubmittedEventId: recordId,
        leaveRequestLastSubmittedName: String(payload.requestedStudentName || matched.studentName || "").trim(),
        leaveRequestLastSubmittedStatus: status,
        leaveRequestLastSubmittedStatusText: this.getLeaveRequestStatusLabel(status),
        leaveRequestLastSubmittedTimeText: this.formatSimpleDateTime(payload.submittedAt || matched.updatedAt || matched.createdAt),
        leaveRequestLastSubmittedTitle: nextTitle
      });
      return matched;
    } catch (err) {
      console.error("[studentSign] loadLatestLeaveRequestSubmission failed", err);
      return null;
    }
  },

  async loadOwnLeaveResult() {
    const lessonId = this.resolveLessonId();
    const applicantStudentId = String(this.data.studentId || "").trim();
    const applicantStudentName = String(this.data.name || "").trim();

    if (!lessonId || !applicantStudentId) {
      this.setData({
        ownLeaveResultStatus: "",
        ownLeaveResultStatusText: "",
        ownLeaveResultTimeText: "",
        ownLeaveResultApplicantName: "",
        ownLeaveResultApplicantId: "",
        ownLeaveResultTargetId: "",
        ownLeaveResultTargetName: "",
        ownLeaveResultTipText: ""
      });
      return null;
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          lessonId,
          type: "leave_request"
        })
        .limit(100)
        .get();
      const matched = (res.data || [])
        .filter((item) => {
          const payload = item?.payload || {};
          return String(payload.applicantStudentId || "").trim() === applicantStudentId;
        })
        .sort((left, right) => this.getLeaveRequestEventTimestamp(right) - this.getLeaveRequestEventTimestamp(left))[0] || null;

      if (!matched) {
        this.setData({
          ownLeaveResultStatus: "",
          ownLeaveResultStatusText: "",
          ownLeaveResultTimeText: "",
          ownLeaveResultApplicantName: applicantStudentName,
          ownLeaveResultApplicantId: applicantStudentId,
          ownLeaveResultTargetId: "",
          ownLeaveResultTargetName: "",
          ownLeaveResultTipText: "暂无结果"
        });
        return null;
      }

      const payload = matched.payload || {};
      const requestStatus = String(payload.status || "").trim() || "pending";
      const requestedStudentId = String(payload.requestedStudentId || matched.studentId || "").trim();
      const requestedStudentName = String(payload.requestedStudentName || matched.studentName || "").trim();
      let requestedAttendanceStatus = "";

      if (requestedStudentId) {
        try {
          const attendanceRes = await db.collection("attendance")
            .where({
              lessonId,
              studentId: requestedStudentId
            })
            .limit(1)
            .get();
          const attendanceDoc = Array.isArray(attendanceRes.data) ? attendanceRes.data[0] || null : null;
          requestedAttendanceStatus = String(
            attendanceDoc?.status ||
            attendanceDoc?.attendanceStatus ||
            ""
          ).trim();
        } catch (err) {
          console.error("[studentSign] loadOwnLeaveResult attendance failed", err);
        }
      }

      const ownLeaveResultStatusText = this.getOwnLeaveResultStatusText(requestedAttendanceStatus, requestStatus);
      const ownLeaveResultTipText = ownLeaveResultStatusText === "已请假"
        ? `${requestedStudentName || "该学生"}已请假`
        : ownLeaveResultStatusText === "待审批"
          ? `${requestedStudentName || "该学生"}待审批`
          : `${requestedStudentName || "该学生"}已关闭`;

      this.setData({
        ownLeaveResultStatus: requestStatus,
        ownLeaveResultStatusText,
        ownLeaveResultTimeText: this.formatSimpleDateTime(payload.approvedAt || payload.submittedAt || matched.updatedAt || matched.createdAt),
        ownLeaveResultApplicantName: String(payload.applicantStudentName || applicantStudentName).trim(),
        ownLeaveResultApplicantId: String(payload.applicantStudentId || applicantStudentId).trim(),
        ownLeaveResultTargetId: requestedStudentId,
        ownLeaveResultTargetName: requestedStudentName,
        ownLeaveResultTipText
      });
      return matched;
    } catch (err) {
      console.error("[studentSign] loadOwnLeaveResult failed", err);
      return null;
    }
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
    const entryMode = String(mergedOptions.entryMode || "").trim();
    const source = String(mergedOptions.source || "").trim();

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

    if (entryMode !== "leave_result" && source !== "student_home" && hasRawEntryParams) {
      const homeUrl = `/pages/studentHome/studentHome?lessonId=${encodeURIComponent(finalLessonId)}`;
      wx.reLaunch({
        url: homeUrl,
        fail: (err) => {
          console.error("[studentSign] redirect studentHome failed", err);
        }
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
        entryMode,
        isLeaveResultView: entryMode === "leave_result",
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

      const resolvedClassId = await this.ensureLessonClassId();
      if (this.data.isLeaveResultView && !resolvedClassId) {
        this.applyInvalidLeaveResultState();
        return;
      }
      await this.loadClassRoster();
      await this.restoreSignSuccessStatus();
      await this.loadOwnLeaveResult();
      await this.loadLatestLeaveRequestSubmission("history");
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
      const resolvedClassId = await this.ensureLessonClassId();
      if (this.data.isLeaveResultView && !resolvedClassId) {
        this.applyInvalidLeaveResultState();
        return;
      }
      await this.loadClassRoster();
      await this.restoreSignSuccessStatus();
      await this.loadOwnLeaveResult();
      await this.loadLatestLeaveRequestSubmission("history");
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
        canInteract: false,
        canSubmitLeaveRequest: false
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
        canInteract: this.getCanInteract({ signSuccess: hasSigned }),
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({ signSuccess: hasSigned })
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
        leaveRequestImageTempPath: tempFilePath,
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestImageTempPath: tempFilePath
        })
      });
    } catch (err) {
      if (err?.errMsg && err.errMsg.includes("cancel")) return;
      console.error("[studentSign] chooseLeaveRequestImage failed", err);
      wx.showToast({ title: "选择假条失败", icon: "none" });
    }
  },

  onInputLeaveRequestTargetName(e) {
    const targetName = String(e.detail?.value || "").trim();
    this.setData({
      leaveRequestTargetName: targetName
    });
    this.updateLeaveRequestTargetMatch(targetName);
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
    if (!String(this.data.leaveRequestTargetName || "").trim()) {
      wx.showToast({ title: "请先填写请假人姓名", icon: "none" });
      return;
    }

    const { lessonId, classId } = await this.resolveLessonContext();

    if (!lessonId || !classId || !applicantStudentId || !applicantStudentName) {
      wx.showToast({ title: "当前课堂信息不完整", icon: "none" });
      return;
    }

    try {
      if (!Array.isArray(this.data.classRoster) || this.data.classRoster.length === 0) {
        await this.loadClassRoster();
      }

      const matchedResult = this.updateLeaveRequestTargetMatch(this.data.leaveRequestTargetName);
      if (!matchedResult) {
        wx.showToast({ title: this.data.leaveRequestTargetStatusText || "请确认请假人信息", icon: "none" });
        return;
      }
      const { requestedStudentId, requestedStudentName } = matchedResult;

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

      this.setData({
        leaveRequestSubmitting: true,
        canSubmitLeaveRequest: false
      });
      wx.showLoading({ title: "提交中...", mask: true });
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: this.getLeaveRequestCloudPath(tempFilePath),
        filePath: tempFilePath
      });
      const imageFileId = String(uploadRes.fileID || "").trim();
      if (!imageFileId) {
        wx.hideLoading();
        this.setData({
          leaveRequestSubmitting: false,
          canSubmitLeaveRequest: this.canSubmitLeaveRequest({
            leaveRequestSubmitting: false
          })
        });
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
        leaveRequestTargetStatus: "empty",
        leaveRequestTargetStatusText: "先填姓名",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        leaveRequestImageTempPath: "",
        leaveRequestImageFileId: imageFileId,
        canSubmitLeaveRequest: false,
        leaveRequestLastSubmittedEventId: "",
        leaveRequestLastSubmittedName: requestedStudentName,
        leaveRequestLastSubmittedStatus: "pending",
        leaveRequestLastSubmittedStatusText: this.getLeaveRequestStatusLabel("pending"),
        leaveRequestLastSubmittedTimeText: this.formatSimpleDateTime(new Date()),
        leaveRequestLastSubmittedTitle: "已提交",
        leaveRequestSubmitting: false
      });
      wx.showToast({
        title: "已提交",
        icon: "none"
      });
      await this.loadLatestLeaveRequestSubmission("current");
    } catch (err) {
      wx.hideLoading();
      this.setData({
        leaveRequestSubmitting: false,
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestSubmitting: false
        })
      });
      console.error("[studentSign] submitLeaveRequest failed", err);
      wx.showToast({ title: "提交失败", icon: "none" });
    }
  },

  goLeaveRequestPage() {
    const lessonId = this.resolveLessonId();
    if (!lessonId) {
      wx.showToast({ title: "当前没有可进入的课堂", icon: "none" });
      return;
    }

    wx.navigateTo({
      url: `/pages/studentLeave/studentLeave?lessonId=${encodeURIComponent(lessonId)}`,
      fail: (err) => {
        console.error("[studentSign] goLeaveRequestPage failed", err);
        wx.showToast({ title: "未能打开请假申请页", icon: "none" });
      }
    });
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
    if (!lessonId) return "";

    const shouldValidateLesson = this.data.isLeaveResultView || !this.data.classId;
    let lessonClassId = "";

    if (shouldValidateLesson) {
      const lesson = await this.getReadableLesson(lessonId, "ensureLessonClassId");
      lessonClassId = String(lesson?.classId || "").trim();
      if (!lesson) {
        return "";
      }
    }

    const nextClassId = lessonClassId || String(this.data.classId || "").trim();
    if (nextClassId) {
      this.setData({
        lessonId,
        classId: nextClassId
      });
      return nextClassId;
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
        .then(() => this.loadOwnLeaveResult())
        .then(() => this.data.isLeaveResultView ? null : this.loadCurrentSingleChoiceTest())
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
        title: `缺少${missingFields.join("/")}`,
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
      classRoster: [],
      entryMode: "",
      isLeaveResultView: false,
      name: "",
      studentId: "",
      signSuccess: false,
      attendanceStatus: "unsigned",
      attendanceStatusText: "未签到",
      leaveRequestTargetName: "",
      leaveRequestTargetStatus: "empty",
      leaveRequestTargetStatusText: "先填姓名",
      leaveRequestMatchedStudentId: "",
      leaveRequestMatchedStudentName: "",
      leaveRequestImageTempPath: "",
      leaveRequestImageFileId: "",
      leaveRequestSubmitting: false,
      canSubmitLeaveRequest: false,
      leaveRequestLastSubmittedEventId: "",
      leaveRequestLastSubmittedName: "",
      leaveRequestLastSubmittedStatus: "",
      leaveRequestLastSubmittedStatusText: "",
      leaveRequestLastSubmittedTimeText: "",
      leaveRequestLastSubmittedTitle: "",
      ownLeaveResultStatus: "",
      ownLeaveResultStatusText: "",
      ownLeaveResultTimeText: "",
      ownLeaveResultApplicantName: "",
      ownLeaveResultApplicantId: "",
      ownLeaveResultTargetId: "",
      ownLeaveResultTargetName: "",
      ownLeaveResultTipText: "",
      currentUser: null,
      shouldGoRegister: true,
      registerTipText: "请重新绑定",
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
