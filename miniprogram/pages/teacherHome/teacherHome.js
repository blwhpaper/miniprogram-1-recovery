const {
  getStoredTeacherSession,
  hasTeacherLogoutGate,
  getApprovedTeacherId,
  cacheApprovedTeacherSession,
  TEACHER_LOGOUT_GATE_KEY
} = require("../../utils/teacherSession");

const TEACHER_HOME_RETURN_KEY = "TEACHER_HOME_RETURN_ONCE";

Page({
  stateLoadToken: 0,

  data: {
    pageLoading: false,
    pageErrorText: "",
    hasTeacherSession: false,
    canEnterTeacherWorkspace: false,
    canResumeTeacherSession: false,
    showTeacherApplyButton: false,
    teacherApplyButtonText: "申请成为老师",
    teacherApplyButtonDisabled: false,
    teacherId: "",
    teacherName: "",
    teacherStatusText: "",
    teacherLeadText: "",
    teacherApplyStatus: "",
    teacherApplyStatusText: "",
    teacherApplySummaryText: "",
    canSubmitTeacherApply: false
  },

  onLoad() {
    this.markTeacherHomeReturn();
    this.loadTeacherHomeState();
  },

  onShow() {
    this.markTeacherHomeReturn();
    this.loadTeacherHomeState();
  },

  markTeacherHomeReturn() {
    wx.setStorageSync(TEACHER_HOME_RETURN_KEY, "1");
  },

  getTeacherDisplayName(teacherId = "") {
    const normalizedTeacherId = String(teacherId || "").trim();
    if (!normalizedTeacherId || normalizedTeacherId === "default") {
      return "老师";
    }
    return `老师 ${normalizedTeacherId}`;
  },

  getTeacherApplyStatusText(status = "") {
    const normalizedStatus = String(status || "").trim();
    const map = {
      pending: "待审核",
      approved: "已开通",
      rejected: "未通过"
    };
    return map[normalizedStatus] || "未申请";
  },

  async loadTeacherHomeState() {
    const loadToken = this.stateLoadToken + 1;
    this.stateLoadToken = loadToken;
    this.setData({
      pageLoading: true,
      pageErrorText: ""
    });
    const localTeacherId = getStoredTeacherSession();
    if (localTeacherId) {
      this.setData({
        hasTeacherSession: true,
        canEnterTeacherWorkspace: true,
        canResumeTeacherSession: false,
        showTeacherApplyButton: false,
        teacherApplyButtonText: "",
        teacherApplyButtonDisabled: false,
        teacherId: localTeacherId,
        teacherName: this.getTeacherDisplayName(localTeacherId),
        teacherStatusText: "已开通",
        teacherLeadText: "",
        teacherApplyStatus: "",
        teacherApplyStatusText: "",
        teacherApplySummaryText: "",
        canSubmitTeacherApply: false
      });
    } else {
      this.setData({
        hasTeacherSession: false,
        canEnterTeacherWorkspace: false,
        canResumeTeacherSession: false,
        showTeacherApplyButton: true,
        teacherApplyButtonText: "申请成为老师",
        teacherApplyButtonDisabled: false,
        teacherId: "",
        teacherName: "老师入口",
        teacherStatusText: "未开通",
        teacherLeadText: "",
        teacherApplyStatus: "",
        teacherApplyStatusText: "未申请",
        teacherApplySummaryText: "暂无申请记录。",
        canSubmitTeacherApply: true
      });
    }

    try {
      const res = await wx.cloud.callFunction({
        name: "teacherApply",
        data: {
          action: "get"
        }
      });
      if (loadToken !== this.stateLoadToken) {
        return;
      }
      const application = res.result?.application || null;
      const teacherProfile = res.result?.teacherProfile || null;
      const status = String(application?.status || "").trim();
      const isPending = status === "pending";
      const approvedTeacherId = getApprovedTeacherId(teacherProfile);
      const isApprovedTeacher = !!approvedTeacherId;
      const hasTeacherSyncGap = !isApprovedTeacher && status === "approved";
      const effectiveApplyStatus = isApprovedTeacher ? "approved" : status;
      const hasLoggedOutTeacher = hasTeacherLogoutGate();
      const canAutoRestoreTeacherSession = !hasLoggedOutTeacher;
      if (!approvedTeacherId && localTeacherId) {
        wx.removeStorageSync("CURRENT_TEACHER");
      }
      const activeTeacherId = canAutoRestoreTeacherSession
        ? cacheApprovedTeacherSession(approvedTeacherId)
        : "";
      const showTeacherApplyButton = !isApprovedTeacher && !hasTeacherSyncGap;
      const teacherApplyButtonText = hasTeacherSyncGap
        ? "教师身份待同步"
        : status === "pending"
        ? "已提交，等待审核"
        : status === "rejected"
          ? "重新申请成为老师"
          : "申请成为老师";
      const teacherApplyButtonDisabled = status === "pending" || hasTeacherSyncGap;
      this.setData({
        hasTeacherSession: !!activeTeacherId,
        canEnterTeacherWorkspace: isApprovedTeacher && !hasLoggedOutTeacher,
        canResumeTeacherSession: isApprovedTeacher && hasLoggedOutTeacher,
        showTeacherApplyButton,
        teacherApplyButtonText,
        teacherApplyButtonDisabled,
        teacherId: approvedTeacherId || "",
        teacherName: approvedTeacherId ? this.getTeacherDisplayName(approvedTeacherId) : "老师入口",
        teacherStatusText: hasLoggedOutTeacher && isApprovedTeacher
          ? "已退出"
          : isApprovedTeacher
            ? "已开通"
            : hasTeacherSyncGap
              ? "待同步"
            : "未开通",
        teacherLeadText: hasLoggedOutTeacher && isApprovedTeacher
          ? ""
          : isApprovedTeacher
          ? ""
          : hasTeacherSyncGap
            ? ""
          : "",
        teacherApplyStatus: effectiveApplyStatus,
        teacherApplyStatusText: this.getTeacherApplyStatusText(effectiveApplyStatus),
        teacherApplySummaryText: hasLoggedOutTeacher && isApprovedTeacher
          ? "可恢复教师态。"
          : isPending
          ? "已提交"
          : hasTeacherSyncGap
            ? "已通过，待同步"
          : status === "approved"
            ? "已通过"
            : status === "rejected"
              ? "未通过，可重提"
              : "暂无申请记录。",
        canSubmitTeacherApply: showTeacherApplyButton && !teacherApplyButtonDisabled
      });
    } catch (err) {
      if (loadToken !== this.stateLoadToken) {
        return;
      }
      console.error("[teacherHome] load teacher apply status failed", err);
      this.setData({
        pageErrorText: "教师状态读取失败",
        teacherApplySummaryText: "申请状态读取失败"
      });
    } finally {
      if (loadToken !== this.stateLoadToken) {
        return;
      }
      this.setData({
        pageLoading: false
      });
    }
  },

  retryLoadTeacherHomeState() {
    this.loadTeacherHomeState();
  },

  goToClassManager() {
    wx.navigateTo({
      url: "/pages/classManager/classManager"
    });
  },

  enterApprovedTeacherWorkspace() {
    const teacherId = String(this.data.teacherId || "").trim();
    if (!teacherId) {
      wx.showToast({
        title: "教师身份数据未就绪",
        icon: "none"
      });
      return;
    }

    cacheApprovedTeacherSession(teacherId);
    this.goToClassManager();
  },

  resumeTeacherSession() {
    this.enterApprovedTeacherWorkspace();
  },

  logoutTeacherSession() {
    wx.showModal({
      title: "退出教师态",
      content: "将只退出当前本地教师登录态，便于继续测试老师注册申请流程。",
      success: (res) => {
        if (!res.confirm) return;

        wx.removeStorageSync("CURRENT_TEACHER");
        wx.setStorageSync(TEACHER_LOGOUT_GATE_KEY, "1");
        this.loadTeacherHomeState();
        wx.showToast({
          title: "已退出教师态",
          icon: "success"
        });
      }
    });
  },

  goToTeacherApply() {
    wx.navigateTo({
      url: "/pages/teacherApply/teacherApply"
    });
  },

  goToAdminTeacherReview() {
    wx.navigateTo({
      url: "/pages/adminTeacherReview/adminTeacherReview"
    });
  }
});
