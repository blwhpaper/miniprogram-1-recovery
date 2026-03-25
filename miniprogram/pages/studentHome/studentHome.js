Page({
  data: {
    lessonId: "",
    classId: "",
    name: "",
    studentId: "",
    hasBoundStudentSession: false,
    statusText: "当前暂无可继续的课堂签到",
    actionText: "",
    emptyTipText: "老师发起签到后，你可以从这里继续进入当前课堂。"
  },

  hasHandledFallbackRedirect: false,

  safeDecode(value = "") {
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
  },

  getPendingLessonId() {
    return this.safeDecode(wx.getStorageSync("pendingLessonId") || "").trim();
  },

  redirectToTeacherHomeIfNeeded() {
    if (this.hasHandledFallbackRedirect) return;

    const currentUser = wx.getStorageSync("currentUser") || null;
    const pendingLessonId = this.getPendingLessonId();
    const hasBoundStudentSession = !!(
      currentUser &&
      String(currentUser.name || "").trim() &&
      String(currentUser.studentId || "").trim()
    );

    if (hasBoundStudentSession || pendingLessonId) return;

    this.hasHandledFallbackRedirect = true;
    wx.reLaunch({
      url: "/pages/classManager/classManager",
      fail: (err) => {
        this.hasHandledFallbackRedirect = false;
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

    let statusText = "当前暂无可继续的课堂签到";
    let actionText = "";
    let emptyTipText = "老师发起签到后，你可以从这里继续进入当前课堂。";

    if (hasBoundStudentSession && pendingLessonId) {
      statusText = "当前有可继续进入的课堂签到";
      actionText = "继续当前签到";
      emptyTipText = "你已保留当前课堂入口，可直接返回签到页继续签到或互动。";
    } else if (!hasBoundStudentSession && pendingLessonId) {
      statusText = "当前有课堂签到，但还未绑定学生身份";
      actionText = "进入当前签到";
      emptyTipText = "进入后可继续完成身份绑定和签到。";
    } else if (hasBoundStudentSession) {
      statusText = "当前学生身份已就绪";
      emptyTipText = "老师发起新的课堂签到后，你可以从这里快速进入。";
    }

    this.setData({
      lessonId: pendingLessonId,
      classId,
      name,
      studentId,
      hasBoundStudentSession,
      statusText,
      actionText,
      emptyTipText
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
