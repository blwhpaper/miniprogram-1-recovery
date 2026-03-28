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
    statusText: "当前暂无进行中的课堂",
    summaryText: "老师发起签到后，你可以从这里继续进入当前课堂。",
    lessonEntryText: "",
    showLessonEntryButton: false,
    showQuestionEntryButton: false
  },

  getPendingLessonId() {
    return String(wx.getStorageSync("pendingLessonId") || "").trim();
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

  async rebuildHomeState() {
    const currentUser = wx.getStorageSync("currentUser") || null;
    const pendingLessonId = this.getPendingLessonId();
    const name = String(currentUser?.name || "").trim();
    const studentId = String(currentUser?.studentId || "").trim();
    const classId = String(currentUser?.classId || "").trim();
    const hasBoundStudentSession = !!(currentUser && name && studentId);
    const currentLessonAttendanceStatus = await this.loadCurrentLessonAttendanceStatus({
      lessonId: pendingLessonId,
      studentId
    });
    const hasSignedCurrentLesson = currentLessonAttendanceStatus === "signed";

    let statusText = "当前暂无进行中的课堂";
    let summaryText = "老师发起签到后，你可以从这里继续进入当前课堂。";
    let lessonEntryText = "";
    let showLessonEntryButton = false;
    let showQuestionEntryButton = false;

    if (hasBoundStudentSession && pendingLessonId) {
      if (currentLessonAttendanceStatus === "leave_agree") {
        statusText = "当前课次状态：已请假";
        summaryText = "本节课已被老师标记为请假，当前无需签到或参与互动。";
        lessonEntryText = "查看当前课堂";
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
    } else if (!hasBoundStudentSession && pendingLessonId) {
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
      lessonId: pendingLessonId,
      classId,
      name,
      studentId,
      hasBoundStudentSession,
      currentLessonAttendanceStatus,
      hasSignedCurrentLesson,
      statusText,
      summaryText,
      lessonEntryText,
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
    const lessonId = this.getPendingLessonId();
    if (!lessonId) {
      wx.showToast({ title: "当前没有可进入的签到课", icon: "none" });
      return;
    }

    wx.navigateTo({
      url: `/pages/studentSign/studentSign?lessonId=${encodeURIComponent(lessonId)}`,
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
