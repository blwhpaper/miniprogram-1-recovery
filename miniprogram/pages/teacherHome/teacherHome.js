Page({
  data: {
    hasTeacherSession: false,
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
    this.loadTeacherHomeState();
  },

  onShow() {
    this.loadTeacherHomeState();
  },

  getCurrentTeacherSession() {
    return String(wx.getStorageSync("CURRENT_TEACHER") || "").trim();
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
    const teacherId = this.getCurrentTeacherSession();
    if (teacherId) {
      this.setData({
        hasTeacherSession: true,
        teacherId,
        teacherName: this.getTeacherDisplayName(teacherId),
        teacherStatusText: "教师身份已就绪",
        teacherLeadText: "这里是教师主页，将统一承接教师端入口与后续教师业务。",
        teacherApplyStatus: "",
        teacherApplyStatusText: "",
        teacherApplySummaryText: "",
        canSubmitTeacherApply: false
      });
      return;
    }

    this.setData({
      hasTeacherSession: false,
      teacherId: "",
      teacherName: "老师入口",
      teacherStatusText: "教师身份未开通",
      teacherLeadText: "如果你需要进入教师端，请先提交老师注册申请。",
      teacherApplyStatus: "",
      teacherApplyStatusText: "未申请",
      teacherApplySummaryText: "当前还没有老师注册申请记录。",
      canSubmitTeacherApply: true
    });

    try {
      const res = await wx.cloud.callFunction({
        name: "teacherApply",
        data: {
          action: "get"
        }
      });
      const application = res.result?.application || null;
      const status = String(application?.status || "").trim();
      const isPending = status === "pending";
      this.setData({
        teacherApplyStatus: status,
        teacherApplyStatusText: this.getTeacherApplyStatusText(status),
        teacherApplySummaryText: isPending
          ? "已提交，等待审核"
          : status === "approved"
            ? "当前申请已通过，后续可接入教师身份开通。"
            : status === "rejected"
              ? "当前申请未通过，可重新填写后再次提交。"
              : "当前还没有老师注册申请记录。",
        canSubmitTeacherApply: status !== "pending"
      });
    } catch (err) {
      console.error("[teacherHome] load teacher apply status failed", err);
      this.setData({
        teacherApplySummaryText: "当前暂时无法读取申请状态，请稍后重试。"
      });
    }
  },

  goToClassManager() {
    wx.navigateTo({
      url: "/pages/classManager/classManager"
    });
  },

  logoutTeacherSession() {
    wx.showModal({
      title: "退出教师态",
      content: "将只退出当前本地教师登录态，便于继续测试老师注册申请流程。",
      success: (res) => {
        if (!res.confirm) return;

        wx.removeStorageSync("CURRENT_TEACHER");
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
  }
});
