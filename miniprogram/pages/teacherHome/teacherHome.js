const {
  getStoredTeacherSession,
  hasTeacherLogoutGate,
  getApprovedTeacherId,
  cacheApprovedTeacherSession,
  TEACHER_LOGOUT_GATE_KEY
} = require("../../utils/teacherSession");

const TEACHER_HOME_RETURN_KEY = "TEACHER_HOME_RETURN_ONCE";

Page({
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
        teacherStatusText: "教师身份已就绪",
        teacherLeadText: "这里是教师主页，将统一承接教师端入口与后续教师业务。",
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
        teacherStatusText: "教师身份未开通",
        teacherLeadText: "如果你需要进入教师端，请先提交老师注册申请。",
        teacherApplyStatus: "",
        teacherApplyStatusText: "未申请",
        teacherApplySummaryText: "当前还没有老师注册申请记录。",
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
          ? "教师态已退出"
          : isApprovedTeacher
            ? "教师身份已开通"
            : hasTeacherSyncGap
              ? "教师身份待同步"
            : "教师身份未开通",
        teacherLeadText: hasLoggedOutTeacher && isApprovedTeacher
          ? "你已退出当前本地教师登录态，如需继续使用教师端，请手动重新进入教师态。"
          : isApprovedTeacher
          ? "当前申请已审核通过，可进入教师业务承接页。"
          : hasTeacherSyncGap
            ? "当前申请已通过，正在等待教师身份同步，请稍后刷新或联系管理员。"
          : "如果你需要进入教师端，请先提交老师注册申请。",
        teacherApplyStatus: effectiveApplyStatus,
        teacherApplyStatusText: this.getTeacherApplyStatusText(effectiveApplyStatus),
        teacherApplySummaryText: hasLoggedOutTeacher && isApprovedTeacher
          ? "当前教师身份已开通，但你已退出本地教师态，可手动重新进入。"
          : isPending
          ? "已提交，等待审核"
          : hasTeacherSyncGap
            ? "当前申请已通过，教师身份正在同步中，请稍后刷新或联系管理员。"
          : status === "approved"
            ? "当前申请已通过，可进入教师业务承接页。"
            : status === "rejected"
              ? "当前申请未通过，可重新填写后再次提交。"
              : "当前还没有老师注册申请记录。",
        canSubmitTeacherApply: showTeacherApplyButton && !teacherApplyButtonDisabled
      });
    } catch (err) {
      console.error("[teacherHome] load teacher apply status failed", err);
      this.setData({
        pageErrorText: "教师状态读取失败，请稍后重试。",
        teacherApplySummaryText: "当前暂时无法读取申请状态，请稍后重试。"
      });
    } finally {
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
