Page({
  data: {
    lessonId: "",
    classId: "",
    name: "",
    studentId: "",
    hasBoundStudentSession: false,
    statusText: "当前暂无进行中的课堂",
    summaryText: "老师发起签到后，你可以从这里继续进入当前课堂。",
    actionText: "",
    showActionButton: false
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

  rebuildHomeState() {
    const currentUser = wx.getStorageSync("currentUser") || null;
    const pendingLessonId = this.getPendingLessonId();
    const name = String(currentUser?.name || "").trim();
    const studentId = String(currentUser?.studentId || "").trim();
    const classId = String(currentUser?.classId || "").trim();
    const hasBoundStudentSession = !!(currentUser && name && studentId);

    let statusText = "当前暂无进行中的课堂";
    let summaryText = "老师发起签到后，你可以从这里继续进入当前课堂。";
    let actionText = "";
    let showActionButton = false;

    if (hasBoundStudentSession && pendingLessonId) {
      statusText = "当前有一节待进入的课堂";
      summaryText = "你可以继续进入本节课，完成签到或继续课堂互动。";
      actionText = "进入当前签到";
      showActionButton = true;
    } else if (!hasBoundStudentSession && pendingLessonId) {
      statusText = "当前有一节待进入的课堂";
      summaryText = "进入后可继续完成学生身份绑定和本次签到。";
      actionText = "进入当前签到";
      showActionButton = true;
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
      statusText,
      summaryText,
      actionText,
      showActionButton
    });
  },

  onLoad() {
    this.rebuildHomeState();
    this.redirectToTeacherHomeIfNeeded();
  },

  onShow() {
    this.rebuildHomeState();
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
  }
});
