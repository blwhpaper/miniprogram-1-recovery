const db = wx.cloud.database();
const _ = db.command;

Page({
  currentEntryLessonId: "",
  lastEntrySyncMeta: null,
  lastPendingClearReason: "",

  data: {
    lessonId: "",
    classId: "",
    name: "",
    studentId: "",
    hasBoundStudentSession: false,
    currentLessonAttendanceStatus: "unsigned",
    currentLessonAttendanceStatusText: "未签到",
    hasSignedCurrentLesson: false,
    currentLeaveRequestStatus: "",
    currentLeaveRequestStatusText: "",
    currentLeaveRequestTargetName: "",
    currentLessonAttendanceScoreText: "",
    currentLessonScoreText: "",
    currentLessonScoreBreakdownText: "",
    showLessonScoreSummary: false,
    pageLeadText: "当前课入口",
    statusText: "当前课状态同步中",
    summaryText: "正在刷新当前课与入口状态，请稍候。",
    debugEntryLessonId: "",
    debugPendingLessonId: "",
    debugResolvedLessonId: "",
    debugLessonAccessState: "",
    debugLessonResolveMode: "",
    debugCloudExists: "",
    debugCloudAttendanceStatus: "",
    debugCloudModeOn: "on",
    debugCloudResult: "",
    debugCloudRequestLessonId: "",
    debugCloudResolvedBy: "",
    debugDidSyncEntryPending: "no",
    debugPendingWriteValue: "",
    debugPendingReadBackValue: "",
    debugPendingSource: "none",
    debugLastPendingClearReason: "",
    debugClearReason: "",
    debugRawErrCode: "",
    debugRawError: "",
    debugRawMessage: "",
    debugRawErrMsg: "",
    lessonEntryText: "",
    lessonEntryMode: "lesson",
    showLessonEntryButton: false,
    showQuestionEntryButton: false
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

  parseLessonIdFromOptions(options = {}) {
    const safeDecode = (value = "") => {
      let result = String(value || "");
      for (let i = 0; i < 2; i += 1) {
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
        params[safeDecode(rawKey)] = safeDecode(rest.join("="));
      });

      return params.lessonId || params.scene || "";
    };

    const directLessonId = safeDecode(options.lessonId || "").trim();
    if (directLessonId) return directLessonId;

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

  syncPendingLessonIdFromEntry(options = {}) {
    const launchEntryParams = this.getLaunchEntryParams();
    const mergedOptions = {
      ...launchEntryParams,
      ...options
    };
    const parsedLessonId = this.parseLessonIdFromOptions(mergedOptions);
    let didSyncEntryPending = "no";
    let pendingWriteValue = "";

    if (parsedLessonId) {
      pendingWriteValue = parsedLessonId;
      this.currentEntryLessonId = parsedLessonId;
      wx.setStorageSync("pendingLessonId", parsedLessonId);
      didSyncEntryPending = "yes";
    } else if (this.currentEntryLessonId) {
      pendingWriteValue = this.currentEntryLessonId;
    }
    const pendingReadBackValue = this.getPendingLessonId();
    this.lastEntrySyncMeta = {
      didSyncEntryPending,
      pendingWriteValue,
      pendingReadBackValue
    };
    return parsedLessonId || this.currentEntryLessonId || "";
  },

  clearPendingLessonIdIfMatch(lessonId = "") {
    const normalizedLessonId = String(lessonId || "").trim();
    if (!normalizedLessonId) return;
    if (this.getPendingLessonId() !== normalizedLessonId) return;
    wx.removeStorageSync("pendingLessonId");
    this.lastPendingClearReason = this.lastPendingClearReason || "clearPendingLessonIdIfMatch";
  },

  getLessonErrorDebug(err) {
    return {
      rawErrCode: String(err?.errCode ?? "").trim(),
      rawError: String(err?.error || "").trim(),
      rawMessage: String(err?.message || "").trim(),
      rawErrMsg: String(err?.errMsg || "").trim()
    };
  },

  getLessonNotFoundReason(err) {
    const errorDebug = this.getLessonErrorDebug(err);
    const candidates = [
      ["error", errorDebug.rawError],
      ["message", errorDebug.rawMessage],
      ["errMsg", errorDebug.rawErrMsg]
    ];

    for (let i = 0; i < candidates.length; i += 1) {
      const [field, rawValue] = candidates[i];
      const value = String(rawValue || "").toLowerCase();
      if (!value) continue;

      if (value.includes("document with _id") && value.includes("does not exist")) {
        return `${field}:document_with_id_does_not_exist`;
      }

      if (value.includes("document not exists")) {
        return `${field}:document_not_exists`;
      }

      if (value.includes("document not exist")) {
        return `${field}:document_not_exist`;
      }

      if (value.includes("cannot find document")) {
        return `${field}:cannot_find_document`;
      }
    }

    return "";
  },

  async getReadableLesson(lessonId = "", logLabel = "") {
    const normalizedLessonId = String(lessonId || "").trim();
    if (!normalizedLessonId) return null;

    try {
      const lessonRes = await db.collection("lessons").doc(normalizedLessonId).get();
      return lessonRes.data || null;
    } catch (err) {
      console.warn(`[studentHome] ${logLabel || "getReadableLesson"} skip invalid lesson`, {
        lessonId: normalizedLessonId,
        err
      });
      this.clearPendingLessonIdIfMatch(normalizedLessonId);
      return null;
    }
  },

  async inspectCurrentLessonCandidate(lessonId = "", logLabel = "") {
    const normalizedLessonId = String(lessonId || "").trim();
    if (!normalizedLessonId) {
      return {
        lessonId: "",
        lesson: null,
        accessState: "empty",
        clearReason: "",
        errorDebug: this.getLessonErrorDebug(null)
      };
    }

    try {
      const lessonRes = await db.collection("lessons").doc(normalizedLessonId).get();
      return {
        lessonId: normalizedLessonId,
        lesson: lessonRes.data || null,
        accessState: lessonRes.data ? "readable" : "empty",
        clearReason: lessonRes.data ? "readable" : "empty",
        errorDebug: this.getLessonErrorDebug(null)
      };
    } catch (err) {
      const errorDebug = this.getLessonErrorDebug(err);
      const notFoundReason = this.getLessonNotFoundReason(err);
      console.warn(`[studentHome] ${logLabel || "inspectCurrentLessonCandidate"} lesson access fallback`, {
        lessonId: normalizedLessonId,
        err,
        errorDebug,
        notFoundReason
      });

      if (notFoundReason) {
        this.lastPendingClearReason = `inspect:${notFoundReason}`;
        this.clearPendingLessonIdIfMatch(normalizedLessonId);
        return {
          lessonId: "",
          lesson: null,
          accessState: "missing",
          clearReason: `clear_pending:${notFoundReason}`,
          errorDebug
        };
      }

      return {
        lessonId: normalizedLessonId,
        lesson: null,
        accessState: "opaque",
        clearReason: "keep_pending:uncertain_read_error",
        errorDebug
      };
    }
  },

  async resolveCurrentLessonByClass(classId = "") {
    const normalizedClassId = String(classId || "").trim();
    if (!normalizedClassId) return null;

    try {
      const res = await db.collection("lessons")
        .where({
          classId: normalizedClassId,
          status: "active"
        })
        .get();
      const lessons = Array.isArray(res.data) ? res.data : [];
      if (lessons.length === 0) return null;

      const getLessonTimestamp = (item = {}) => {
        const rawValue = item.startTime || item.createdAt;
        if (!rawValue) return 0;
        if (typeof rawValue?.toDate === "function") {
          const date = rawValue.toDate();
          return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
        }
        const date = rawValue instanceof Date ? rawValue : new Date(rawValue);
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
      };

      lessons.sort((left, right) => {
        return getLessonTimestamp(right) - getLessonTimestamp(left);
      });

      return lessons[0] || null;
    } catch (err) {
      console.warn("[studentHome] resolveCurrentLessonByClass failed", {
        classId: normalizedClassId,
        err
      });
      return null;
    }
  },

  async syncCurrentUser() {
    try {
      const res = await wx.cloud.callFunction({
        name: "getMyUser"
      });
      const result = res.result || {};
      if (result.success && result.bound && result.user) {
        wx.setStorageSync("currentUser", result.user);
        return result.user;
      }
      if (result.success && !result.bound) {
        wx.removeStorageSync("currentUser");
        return null;
      }
    } catch (err) {
      console.warn("[studentHome] syncCurrentUser failed", err);
    }

    return wx.getStorageSync("currentUser") || null;
  },

  async resolveStudentLessonEntryByCloud({ lessonId = "", classId = "" } = {}) {
    try {
      const res = await wx.cloud.callFunction({
        name: "resolveStudentLessonEntry",
        data: {
          lessonId: String(lessonId || "").trim(),
          classId: String(classId || "").trim()
        }
      });
      const result = res.result || {};
      if (!result.success) {
        console.warn("[studentHome] resolveStudentLessonEntryByCloud failed", result);
      }
      return result;
    } catch (err) {
      console.warn("[studentHome] resolveStudentLessonEntryByCloud failed", err);
      return {
        success: false,
        exists: false,
        readable: false,
        lessonId: "",
        classId: String(classId || "").trim(),
        lessonStatus: "",
        attendanceStatus: "",
        canEnterCurrentLesson: false,
        statusHint: "error",
        resolvedBy: "error",
        notFound: false
      };
    }
  },

  redirectToTeacherHomeIfNeeded() {
    const currentTeacher = String(wx.getStorageSync("CURRENT_TEACHER") || "").trim();
    if (!currentTeacher) return false;

    wx.reLaunch({
      url: "/pages/teacherHome/teacherHome",
      fail: (err) => {
        console.error("[studentHome] redirect teacherHome failed", err);
      }
    });
    return true;
  },

  getLeaveRequestStatusLabel(status = "") {
    const normalizedStatus = String(status || "").trim();
    const map = {
      pending: "待审批",
      approved: "已请假",
      closed: "已关闭"
    };
    return map[normalizedStatus] || "";
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

  parseScore(value) {
    if (value === "" || value === null || typeof value === "undefined") {
      return null;
    }

    const score = Number(value);
    return Number.isFinite(score) ? score : null;
  },

  formatScore(value) {
    if (!Number.isFinite(value)) return "";
    const fixedScore = Math.round(value * 100) / 100;
    return Number.isInteger(fixedScore)
      ? String(fixedScore)
      : fixedScore.toFixed(2).replace(/\.?0+$/, "");
  },

  getAverageScore(scoreList = []) {
    const validScores = (scoreList || []).filter((score) => Number.isFinite(score));
    if (validScores.length === 0) return null;
    const total = validScores.reduce((sum, score) => sum + score, 0);
    return Math.round((total / validScores.length) * 100) / 100;
  },

  buildLessonScoreDetail(status = "", options = {}) {
    const normalizedStatus = String(status || "").trim();
    const answerScoreAvg = Number.isFinite(options.answerScoreAvg) ? options.answerScoreAvg : null;
    const questionScoreAvg = Number.isFinite(options.questionScoreAvg) ? options.questionScoreAvg : null;
    const testScoreAvg = Number.isFinite(options.testScoreAvg) ? options.testScoreAvg : null;

    if (normalizedStatus === "leave_agree") {
      return {
        attendanceScoreText: "60",
        lessonScoreText: "60",
        lessonScoreBreakdownText: "请假60"
      };
    }

    if (normalizedStatus === "absent") {
      return {
        attendanceScoreText: "0",
        lessonScoreText: "0",
        lessonScoreBreakdownText: "旷课0"
      };
    }

    const applicableItems = [];
    if (normalizedStatus === "signed") {
      applicableItems.push({
        label: "到课",
        score: 80
      });
    }
    if (Number.isFinite(answerScoreAvg)) {
      applicableItems.push({
        label: "随机点名",
        score: answerScoreAvg
      });
    }
    if (Number.isFinite(questionScoreAvg)) {
      applicableItems.push({
        label: "主动提问",
        score: questionScoreAvg
      });
    }
    if (Number.isFinite(testScoreAvg)) {
      applicableItems.push({
        label: "随堂测试",
        score: testScoreAvg
      });
    }

    if (applicableItems.length === 0) {
      return {
        attendanceScoreText: normalizedStatus === "signed" ? "80" : "",
        lessonScoreText: "",
        lessonScoreBreakdownText: ""
      };
    }

    const lessonScore = this.getAverageScore(applicableItems.map((item) => item.score));
    return {
      attendanceScoreText: normalizedStatus === "signed" ? "80" : "",
      lessonScoreText: this.formatScore(lessonScore),
      lessonScoreBreakdownText: applicableItems
        .map((item) => `${item.label}${this.formatScore(item.score)}`)
        .join(" / ")
    };
  },

  async loadCurrentLessonScoreSummary({ lessonId = "", studentId = "", attendanceStatus = "" } = {}) {
    if (!lessonId || !studentId) {
      return {
        attendanceStatusText: this.getAttendanceStatusLabel(attendanceStatus),
        attendanceScoreText: "",
        lessonScoreText: "",
        lessonScoreBreakdownText: "",
        showLessonScoreSummary: false
      };
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          lessonId,
          studentId,
          type: _.in(["answer_score", "question_score", "test_record"])
        })
        .get();
      const lessonEvents = Array.isArray(res.data) ? res.data : [];
      const answerScores = [];
      const questionScores = [];
      const testScores = [];

      lessonEvents.forEach((item) => {
        const score = this.parseScore(item.score);
        if (!Number.isFinite(score)) return;

        if (item.type === "answer_score") {
          answerScores.push(score);
          return;
        }

        if (item.type === "question_score") {
          questionScores.push(score);
          return;
        }

        if (item.type === "test_record") {
          testScores.push(score);
        }
      });

      const scoreDetail = this.buildLessonScoreDetail(attendanceStatus, {
        answerScoreAvg: this.getAverageScore(answerScores),
        questionScoreAvg: this.getAverageScore(questionScores),
        testScoreAvg: this.getAverageScore(testScores)
      });

      return {
        attendanceStatusText: this.getAttendanceStatusLabel(attendanceStatus),
        attendanceScoreText: scoreDetail.attendanceScoreText,
        lessonScoreText: scoreDetail.lessonScoreText,
        lessonScoreBreakdownText: scoreDetail.lessonScoreBreakdownText,
        showLessonScoreSummary: Boolean(
          this.getAttendanceStatusLabel(attendanceStatus) ||
          scoreDetail.attendanceScoreText ||
          scoreDetail.lessonScoreText ||
          scoreDetail.lessonScoreBreakdownText
        )
      };
    } catch (err) {
      console.error("[studentHome] loadCurrentLessonScoreSummary failed", err);
      return {
        attendanceStatusText: this.getAttendanceStatusLabel(attendanceStatus),
        attendanceScoreText: "",
        lessonScoreText: "",
        lessonScoreBreakdownText: "",
        showLessonScoreSummary: Boolean(attendanceStatus)
      };
    }
  },

  getLeaveRequestEventTimestamp(item = {}) {
    const payload = item?.payload || {};
    const candidateList = [payload.approvedAt, payload.submittedAt, item.updatedAt, item.createdAt];

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

  async resolveLeaveResultLesson(applicantStudentId = "", excludedLessonIds = []) {
    if (!applicantStudentId) return null;

    try {
      const res = await db.collection("lessonEvent")
        .where({
          type: "leave_request"
        })
        .limit(100)
        .get();
      const candidates = (res.data || [])
        .filter((item) => {
          const payload = item?.payload || {};
          return String(payload.applicantStudentId || "").trim() === applicantStudentId;
        })
        .filter((item) => String(item.lessonId || "").trim())
        .filter((item) => !excludedLessonIds.includes(String(item.lessonId || "").trim()))
        .sort((left, right) => this.getLeaveRequestEventTimestamp(right) - this.getLeaveRequestEventTimestamp(left));

      let readableFallback = null;

      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const lessonId = String(candidate.lessonId || "").trim();
        if (!lessonId) continue;

        const lesson = await this.getReadableLesson(lessonId, "resolveLeaveResultLesson");
        if (!lesson) {
          continue;
        }

        if (String(lesson.status || "").trim() === "active") {
          return candidate;
        }

        if (!readableFallback) {
          readableFallback = candidate;
        }
      }

      return readableFallback;
    } catch (err) {
      console.error("[studentHome] resolveLeaveResultLesson failed", err);
      return null;
    }
  },

  async loadCurrentLeaveRequestResult({ lessonId = "", applicantStudentId = "" } = {}) {
    if (!applicantStudentId) return null;

    let targetLessonId = String(lessonId || "").trim();
    const excludedLessonIds = [];

    if (targetLessonId) {
      const lesson = await this.getReadableLesson(targetLessonId, "loadCurrentLeaveRequestResult");
      if (!lesson) {
        excludedLessonIds.push(targetLessonId);
        targetLessonId = "";
      }
    }

    if (!targetLessonId) {
      const latestCandidate = await this.resolveLeaveResultLesson(applicantStudentId, excludedLessonIds);
      targetLessonId = String(latestCandidate?.lessonId || "").trim();
      if (!targetLessonId) return null;
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          lessonId: targetLessonId,
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
        if (targetLessonId) {
          return this.loadCurrentLeaveRequestResult({
            lessonId: "",
            applicantStudentId
          });
        }
        return null;
      }

      const payload = matched.payload || {};
      const requestStatus = String(payload.status || "").trim() || "pending";
      return {
        lessonId: targetLessonId,
        requestId: String(matched._id || "").trim(),
        requestStatus,
        requestStatusText: this.getLeaveRequestStatusLabel(requestStatus),
        requestedStudentId: String(payload.requestedStudentId || matched.studentId || "").trim(),
        requestedStudentName: String(payload.requestedStudentName || matched.studentName || "").trim()
      };
    } catch (err) {
      console.error("[studentHome] loadCurrentLeaveRequestResult failed", err);
      return null;
    }
  },

  async rebuildHomeState(currentUserInput = undefined, options = {}) {
    const currentUser = currentUserInput !== undefined
      ? currentUserInput
      : (wx.getStorageSync("currentUser") || null);
    const name = String(currentUser?.name || "").trim();
    const studentId = String(currentUser?.studentId || "").trim();
    const classId = String(currentUser?.classId || "").trim();
    const hasBoundStudentSession = !!(currentUser && name && studentId);
    const entryLessonId = String(options.entryLessonId || "").trim();
    const storagePendingLessonId = this.getPendingLessonId();
    const retainedEntryLessonId = String(this.currentEntryLessonId || "").trim();
    const pendingLessonId = String(
      storagePendingLessonId ||
      entryLessonId ||
      retainedEntryLessonId ||
      ""
    ).trim();
    const pendingSource = storagePendingLessonId
      ? "storage"
      : pendingLessonId
        ? "entry"
        : "none";
    const cloudLessonEntry = await this.resolveStudentLessonEntryByCloud({
      lessonId: pendingLessonId,
      classId
    });
    const cloudResolvedLessonId = String(
      cloudLessonEntry?.exists && cloudLessonEntry?.canEnterCurrentLesson
        ? cloudLessonEntry.lessonId || ""
        : ""
    ).trim();
    const cloudAttendanceStatus = String(cloudLessonEntry?.attendanceStatus || "").trim();
    const currentLeaveRequestResult = hasBoundStudentSession && !cloudResolvedLessonId
      ? await this.loadCurrentLeaveRequestResult({
        lessonId: "",
        applicantStudentId: studentId
      })
      : null;
    const resolvedLessonId = String(
      currentLeaveRequestResult?.lessonId ||
      cloudResolvedLessonId ||
      ""
    ).trim();

    if (resolvedLessonId && resolvedLessonId !== pendingLessonId) {
      wx.setStorageSync("pendingLessonId", resolvedLessonId);
      this.currentEntryLessonId = resolvedLessonId;
    } else if (!resolvedLessonId && pendingLessonId && cloudLessonEntry?.notFound) {
      this.lastPendingClearReason = "rebuild:cloud_not_found";
      this.clearPendingLessonIdIfMatch(pendingLessonId);
    }

    const currentLessonAttendanceStatus = resolvedLessonId
      ? (cloudAttendanceStatus || await this.loadCurrentLessonAttendanceStatus({
        lessonId: resolvedLessonId,
        studentId
      }))
      : "unsigned";
    const currentLessonScoreSummary = await this.loadCurrentLessonScoreSummary({
      lessonId: resolvedLessonId,
      studentId,
      attendanceStatus: currentLessonAttendanceStatus
    });
    const hasSignedCurrentLesson = currentLessonAttendanceStatus === "signed";
    const currentLeaveRequestStatus = String(currentLeaveRequestResult?.requestStatus || "").trim();
    const currentLeaveRequestStatusText = String(currentLeaveRequestResult?.requestStatusText || "").trim();
    const currentLeaveRequestTargetName = String(currentLeaveRequestResult?.requestedStudentName || "").trim();

    let statusText = "当前暂无进行中的课堂";
    let summaryText = "当前没有可继续进入的课堂，老师发起后会直接显示在这里。";
    let pageLeadText = "当前课入口";
    let lessonEntryText = "";
    let lessonEntryMode = "lesson";
    let showLessonEntryButton = false;
    let showQuestionEntryButton = false;

    if (hasBoundStudentSession && resolvedLessonId) {
      const shouldShowLeaveResultEntry = (
        currentLessonAttendanceStatus === "leave_agree" ||
        currentLeaveRequestStatus === "pending" ||
        currentLeaveRequestStatus === "approved" ||
        currentLeaveRequestStatus === "closed"
      );

      if (shouldShowLeaveResultEntry) {
        pageLeadText = "当前课状态";
        const leaveResultText = currentLessonAttendanceStatus === "leave_agree"
          ? "已请假"
          : currentLeaveRequestStatusText;
        const targetStudentName = currentLeaveRequestTargetName || "该学生";
        statusText = `当前课次状态：${leaveResultText || "未签到"}`;
        summaryText = currentLessonAttendanceStatus === "leave_agree"
          ? `你代${targetStudentName}提交的请假申请已通过，可从这里查看结果。`
          : currentLeaveRequestStatus === "pending"
            ? `你代${targetStudentName}提交的请假申请仍在等待老师处理，可从这里查看当前结果。`
            : `你代${targetStudentName}提交的请假申请已关闭，可从这里查看处理结果。`;
        lessonEntryText = "查看本课请假结果";
        lessonEntryMode = "leave_result";
        showLessonEntryButton = true;
      } else if (currentLessonAttendanceStatus === "absent") {
        pageLeadText = "当前课状态";
        statusText = "当前课次状态：旷课";
        summaryText = "本节课已被老师标记为旷课，当前不可签到或参与互动。";
        lessonEntryText = "继续进入当前课堂";
        showLessonEntryButton = true;
      } else if (currentLessonAttendanceStatus === "leave_wait") {
        pageLeadText = "当前课状态";
        statusText = "当前课次状态：待审批";
        summaryText = "当前请假状态待审批，暂不可继续签到或互动。";
        lessonEntryText = "继续进入当前课堂";
        showLessonEntryButton = true;
      } else {
        pageLeadText = hasSignedCurrentLesson
          ? "当前课状态"
          : "当前课状态";
        statusText = hasSignedCurrentLesson
          ? "当前课次状态：已签到，可继续进入"
          : "当前课次状态：可进入当前课";
        summaryText = hasSignedCurrentLesson
          ? "你已完成签到，可继续进入当前课堂或发起主动提问。"
          : "你可以进入本节课，完成签到后再参与课堂互动。";
        lessonEntryText = "继续进入当前课堂";
        showLessonEntryButton = true;
        showQuestionEntryButton = hasSignedCurrentLesson;
      }
    } else if (!hasBoundStudentSession && resolvedLessonId) {
      pageLeadText = "当前课入口";
      statusText = "当前课次状态：可进入当前课";
      summaryText = "进入后可继续完成学生身份绑定和本次签到。";
      lessonEntryText = "继续进入当前课堂";
      showLessonEntryButton = true;
    } else if (hasBoundStudentSession) {
      pageLeadText = "当前课入口";
      statusText = "当前暂无进行中的课堂";
      summaryText = "当前没有可继续进入的课堂，老师发起后会直接显示在这里。";
    } else {
      pageLeadText = "当前课入口";
      statusText = "当前暂无进行中的课堂";
      summaryText = "当前没有可继续进入的课堂，请等待老师发起或重新扫码进入。";
    }

    this.setData({
      lessonId: resolvedLessonId,
      classId: String(cloudLessonEntry?.classId || classId || "").trim(),
      name,
      studentId,
      hasBoundStudentSession,
      currentLessonAttendanceStatus,
      currentLessonAttendanceStatusText: currentLessonScoreSummary.attendanceStatusText,
      currentLessonAttendanceScoreText: currentLessonScoreSummary.attendanceScoreText,
      currentLessonScoreText: currentLessonScoreSummary.lessonScoreText,
      currentLessonScoreBreakdownText: currentLessonScoreSummary.lessonScoreBreakdownText,
      showLessonScoreSummary: currentLessonScoreSummary.showLessonScoreSummary,
      pageLeadText,
      hasSignedCurrentLesson,
      currentLeaveRequestStatus,
      currentLeaveRequestStatusText,
      currentLeaveRequestTargetName,
      statusText,
      summaryText,
      debugEntryLessonId: entryLessonId,
      debugPendingLessonId: this.getPendingLessonId(),
      debugResolvedLessonId: resolvedLessonId,
      debugLessonAccessState: cloudLessonEntry?.exists
        ? "cloud_exists"
        : cloudLessonEntry?.notFound
          ? "cloud_missing"
          : "cloud_empty",
      debugLessonResolveMode: "cloud",
      debugCloudExists: String(!!cloudLessonEntry?.exists),
      debugCloudAttendanceStatus: cloudAttendanceStatus,
      debugCloudModeOn: "on",
      debugCloudResult: String(cloudLessonEntry?.success ? "success" : "fail"),
      debugCloudRequestLessonId: pendingLessonId,
      debugCloudResolvedBy: String(cloudLessonEntry?.resolvedBy || "").trim(),
      debugDidSyncEntryPending: String(this.lastEntrySyncMeta?.didSyncEntryPending || "no"),
      debugPendingWriteValue: String(this.lastEntrySyncMeta?.pendingWriteValue || ""),
      debugPendingReadBackValue: String(this.lastEntrySyncMeta?.pendingReadBackValue || ""),
      debugPendingSource: pendingSource,
      debugLastPendingClearReason: String(this.lastPendingClearReason || ""),
      debugClearReason: String(cloudLessonEntry?.statusHint || "").trim(),
      debugRawErrCode: "",
      debugRawError: "",
      debugRawMessage: String(cloudLessonEntry?.msg || "").trim(),
      debugRawErrMsg: "",
      lessonEntryText,
      lessonEntryMode,
      showLessonEntryButton,
      showQuestionEntryButton
    });
  },

  async loadCurrentLessonAttendanceStatus({ lessonId = "", studentId = "" } = {}) {
    if (!lessonId || !studentId) return "unsigned";

    try {
      const res = await db.collection("attendance")
        .where({
          lessonId,
          studentId
        })
        .limit(1)
        .get();
      const attendanceDoc = Array.isArray(res.data) ? res.data[0] || null : null;
      return String(
        attendanceDoc?.status ||
        attendanceDoc?.attendanceStatus ||
        "unsigned"
      ).trim() || "unsigned";
    } catch (err) {
      console.error("[studentHome] loadCurrentLessonAttendanceStatus failed", err);
      return "unsigned";
    }
  },

  async onLoad(options = {}) {
    if (this.redirectToTeacherHomeIfNeeded()) return;
    const entryLessonId = this.syncPendingLessonIdFromEntry(options);
    const currentUser = await this.syncCurrentUser();
    await this.rebuildHomeState(currentUser, { entryLessonId });
  },

  async onShow() {
    if (this.redirectToTeacherHomeIfNeeded()) return;
    const entryLessonId = this.syncPendingLessonIdFromEntry();
    const currentUser = await this.syncCurrentUser();
    await this.rebuildHomeState(currentUser, { entryLessonId });
  },

  enterCurrentLesson() {
    const lessonId = String(this.data.lessonId || this.getPendingLessonId() || "").trim();
    if (!lessonId) {
      wx.showToast({ title: "当前没有可进入的签到课", icon: "none" });
      return;
    }

    const entryMode = String(this.data.lessonEntryMode || "lesson").trim();
    const url = entryMode === "leave_result"
      ? `/pages/studentSign/studentSign?lessonId=${encodeURIComponent(lessonId)}&entryMode=leave_result&source=student_home`
      : `/pages/studentSign/studentSign?lessonId=${encodeURIComponent(lessonId)}&source=student_home`;

    wx.navigateTo({
      url,
      fail: (err) => {
        console.error("[studentHome] enterCurrentLesson failed", err);
        wx.showToast({ title: "未能打开签到页", icon: "none" });
      }
    });
  },

  enterQuestionEntry() {
    const lessonId = this.getPendingLessonId();
    if (!lessonId) {
      wx.showToast({ title: "当前没有可进入的课堂", icon: "none" });
      return;
    }

    if (!this.data.hasSignedCurrentLesson) {
      wx.showToast({ title: "请先完成签到后再主动提问", icon: "none" });
      return;
    }

    wx.navigateTo({
      url: `/pages/studentQuestion/studentQuestion?lessonId=${encodeURIComponent(lessonId)}`,
      fail: (err) => {
        console.error("[studentHome] enterQuestionEntry failed", err);
        wx.showToast({ title: "未能打开主动提问入口", icon: "none" });
      }
    });
  },

  enterLeaveRequestPage() {
    const lessonId = String(this.data.lessonId || this.getPendingLessonId() || "").trim();
    if (!lessonId) {
      wx.showToast({ title: "当前没有可进入的课堂", icon: "none" });
      return;
    }

    wx.navigateTo({
      url: `/pages/studentLeave/studentLeave?lessonId=${encodeURIComponent(lessonId)}`,
      fail: (err) => {
        console.error("[studentHome] enterLeaveRequestPage failed", err);
        wx.showToast({ title: "未能打开请假申请页", icon: "none" });
      }
    });
  },

  enterTeacherApply() {
    wx.navigateTo({
      url: "/pages/teacherHome/teacherHome",
      fail: (err) => {
        console.error("[studentHome] enterTeacherApply failed", err);
        wx.showToast({ title: "未能打开老师入口", icon: "none" });
      }
    });
  }
});
