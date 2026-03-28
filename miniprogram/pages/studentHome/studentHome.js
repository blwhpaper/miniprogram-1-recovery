const db = wx.cloud.database();

Page({
  data: {
    lessonId: "",
    classId: "",
    name: "",
    studentId: "",
    hasBoundStudentSession: false,
    currentLessonAttendanceStatus: "unsigned",
    hasSignedCurrentLesson: false,
    currentLeaveRequestStatus: "",
    currentLeaveRequestStatusText: "",
    currentLeaveRequestTargetName: "",
    statusText: "当前暂无进行中的课堂",
    summaryText: "老师发起签到后，你可以从这里继续进入当前课堂。",
    lessonEntryText: "",
    lessonEntryMode: "lesson",
    showLessonEntryButton: false,
    showQuestionEntryButton: false
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

  redirectToTeacherHomeIfNeeded() {
    const currentTeacher = String(wx.getStorageSync("CURRENT_TEACHER") || "").trim();
    if (!currentTeacher) return;

    wx.reLaunch({
      url: "/pages/classManager/classManager",
      fail: (err) => {
        console.error("[studentHome] redirect classManager failed", err);
      }
    });
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

  async rebuildHomeState() {
    const currentUser = wx.getStorageSync("currentUser") || null;
    const name = String(currentUser?.name || "").trim();
    const studentId = String(currentUser?.studentId || "").trim();
    const classId = String(currentUser?.classId || "").trim();
    const hasBoundStudentSession = !!(currentUser && name && studentId);
    const pendingLessonId = this.getPendingLessonId();
    const safePendingLesson = pendingLessonId
      ? await this.getReadableLesson(pendingLessonId, "rebuildHomeState")
      : null;
    const safePendingLessonId = safePendingLesson ? pendingLessonId : "";
    const currentLeaveRequestResult = hasBoundStudentSession
      ? await this.loadCurrentLeaveRequestResult({
        lessonId: safePendingLessonId,
        applicantStudentId: studentId
      })
      : null;
    const resolvedLessonId = String(
      currentLeaveRequestResult?.lessonId ||
      safePendingLessonId ||
      ""
    ).trim();

    if (resolvedLessonId && resolvedLessonId !== pendingLessonId) {
      wx.setStorageSync("pendingLessonId", resolvedLessonId);
    } else if (!resolvedLessonId && pendingLessonId) {
      this.clearPendingLessonIdIfMatch(pendingLessonId);
    }

    const currentLessonAttendanceStatus = await this.loadCurrentLessonAttendanceStatus({
      lessonId: resolvedLessonId,
      studentId
    });
    const hasSignedCurrentLesson = currentLessonAttendanceStatus === "signed";
    const currentLeaveRequestStatus = String(currentLeaveRequestResult?.requestStatus || "").trim();
    const currentLeaveRequestStatusText = String(currentLeaveRequestResult?.requestStatusText || "").trim();
    const currentLeaveRequestTargetName = String(currentLeaveRequestResult?.requestedStudentName || "").trim();

    let statusText = "当前暂无进行中的课堂";
    let summaryText = "老师发起签到后，你可以从这里继续进入当前课堂。";
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
        statusText = "当前课次状态：旷课";
        summaryText = "本节课已被老师标记为旷课，当前不可签到或参与互动。";
        lessonEntryText = "查看当前课堂";
        showLessonEntryButton = true;
      } else if (currentLessonAttendanceStatus === "leave_wait") {
        statusText = "当前课次状态：待审批";
        summaryText = "当前请假状态待审批，暂不可继续签到或互动。";
        lessonEntryText = "查看当前课堂";
        showLessonEntryButton = true;
      } else {
        statusText = "当前有一节待进入的课堂";
        summaryText = hasSignedCurrentLesson
          ? "你已完成签到，可从这里进入本节课或继续发起主动提问。"
          : "你可以进入本节课，完成签到后再参与课堂互动。";
        lessonEntryText = hasSignedCurrentLesson ? "进入当前课堂" : "进入当前签到";
        showLessonEntryButton = true;
        showQuestionEntryButton = hasSignedCurrentLesson;
      }
    } else if (!hasBoundStudentSession && resolvedLessonId) {
      statusText = "当前有一节待进入的课堂";
      summaryText = "进入后可继续完成学生身份绑定和本次签到。";
      lessonEntryText = "进入当前签到";
      showLessonEntryButton = true;
    } else if (hasBoundStudentSession) {
      summaryText = "你的学生身份已就绪。老师发起签到后，你可以从这里快速进入。";
    } else {
      summaryText = "当前还没有可继续进入的课堂。老师发起签到后，你可以扫码进入。";
    }

    this.setData({
      lessonId: resolvedLessonId,
      classId,
      name,
      studentId,
      hasBoundStudentSession,
      currentLessonAttendanceStatus,
      hasSignedCurrentLesson,
      currentLeaveRequestStatus,
      currentLeaveRequestStatusText,
      currentLeaveRequestTargetName,
      statusText,
      summaryText,
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

  async onLoad() {
    await this.rebuildHomeState();
    this.redirectToTeacherHomeIfNeeded();
  },

  async onShow() {
    await this.rebuildHomeState();
    this.redirectToTeacherHomeIfNeeded();
  },

  enterCurrentLesson() {
    const lessonId = String(this.data.lessonId || this.getPendingLessonId() || "").trim();
    if (!lessonId) {
      wx.showToast({ title: "当前没有可进入的签到课", icon: "none" });
      return;
    }

    const entryMode = String(this.data.lessonEntryMode || "lesson").trim();
    const url = entryMode === "leave_result"
      ? `/pages/studentSign/studentSign?lessonId=${encodeURIComponent(lessonId)}&entryMode=leave_result`
      : `/pages/studentSign/studentSign?lessonId=${encodeURIComponent(lessonId)}`;

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
  }
});
