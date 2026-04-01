Page({
  adminReviewSessionKey: "ADMIN_REVIEW_KEY",

  data: {
    adminReviewKey: "",
    resetApplicantOpenId: "",
    applications: [],
    loading: false,
    teacherSourceAvailable: true,
    teacherSourceDegraded: false,
    teacherSourceReason: "",
    teacherSourceMessage: "",
    resettingTeacherState: false,
    reviewingOpenId: "",
    emptyText: "暂无申请",
    pageState: "passwordRequired",
    stateTitle: "输入审核口令",
    stateDescription: "输入后读取申请。"
  },

  onLoad() {
    const cachedReviewKey = String(wx.getStorageSync(this.adminReviewSessionKey) || "").trim();
    if (!cachedReviewKey) {
      this.resetPageState();
      return;
    }

    this.setData({
      adminReviewKey: cachedReviewKey
    });
    this.loadApplications();
  },

  getPageStateMeta(pageState) {
    const map = {
      loading: {
        stateTitle: "加载中",
        stateDescription: "正在读取申请。"
      },
      unauthorized: {
        stateTitle: "无权限",
        stateDescription: "无法查看申请。"
      },
      passwordRequired: {
        stateTitle: "输入审核口令",
        stateDescription: "输入后读取申请。"
      },
      empty: {
        stateTitle: "暂无申请",
        stateDescription: "没有待审核申请。"
      },
      ready: {
        stateTitle: "待审核",
        stateDescription: "可通过或驳回。"
      }
    };

    return map[pageState] || map.passwordRequired;
  },

  setPageState(pageState, extraData = {}) {
    const meta = this.getPageStateMeta(pageState);
    this.setData({
      pageState,
      ...meta,
      ...extraData
    });
  },

  resetPageState() {
    this.setPageState("passwordRequired", {
      applications: [],
      loading: false,
      teacherSourceAvailable: true,
      teacherSourceDegraded: false,
      teacherSourceReason: "",
      teacherSourceMessage: "",
      reviewingOpenId: "",
      emptyText: "暂无申请"
    });
  },

  inputAdminReviewKey(e) {
    this.setData({
      adminReviewKey: String(e.detail.value || "").trim()
    });
  },

  inputResetApplicantOpenId(e) {
    this.setData({
      resetApplicantOpenId: String(e.detail.value || "").trim()
    });
  },

  formatDateTime(value) {
    const rawValue = value && typeof value.toDate === "function" ? value.toDate() : value;
    const date = rawValue instanceof Date ? rawValue : new Date(rawValue);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "-";

    const pad = (num) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  getStatusText(status = "") {
    const normalizedStatus = String(status || "").trim();
    const map = {
      pending: "待审核",
      approved: "已通过",
      rejected: "已驳回"
    };
    return map[normalizedStatus] || "未申请";
  },

  getTeacherSourceStatusText(status = "") {
    const normalizedStatus = String(status || "").trim();
    const map = {
      active: "已进入 teachers 真源",
      inactive: "teachers 真源未生效",
      missing: "未找到 teachers 真源记录",
      degraded: "teachers 真源异常"
    };
    return map[normalizedStatus] || "未确认 teachers 真源状态";
  },

  buildReviewSuccessToast(result = {}, reviewStatus = "") {
    const teacherSourceStatus = String(result.teacherSourceStatus || "").trim();
    if (reviewStatus === "approved") {
      return teacherSourceStatus === "active"
        ? "审核通过，真源已生效"
        : "申请已通过，真源待确认";
    }

    if (teacherSourceStatus === "inactive") {
      return "已驳回，真源已回退";
    }

    return "已驳回，当前无真源";
  },

  buildResetSuccessToast(result = {}) {
    const teacherSourceStatus = String(result.teacherSourceStatus || "").trim();
    return teacherSourceStatus === "inactive"
      ? "已重置，真源已回退"
      : "已重置，真源待确认";
  },

  normalizeApplicationItem(item = {}) {
    const application = item.application || {};
    const teacherProfile = item.teacherProfile || null;
    const status = String(application.status || "").trim();
    const teacherSourceStatus = String(item.teacherSourceStatus || "").trim();
    const teacherSourceDegraded = !!item.teacherSourceDegraded;
    const teacherSourceMessage = String(item.teacherSourceMessage || "").trim();
    return {
      applicantOpenId: String(application.applicantOpenId || item._openid || "").trim(),
      applicantName: String(application.applicantName || "").trim() || "-",
      contactInfo: String(application.contactInfo || "").trim() || "-",
      remark: String(application.remark || "").trim() || "无",
      status,
      teacherSourceStatus,
      statusText: this.getStatusText(status),
      applicationStatusText: this.getStatusText(status),
      teacherSourceStatusText: String(item.teacherSourceLabel || "").trim() || this.getTeacherSourceStatusText(teacherSourceStatus),
      teacherSourceWarningText: teacherSourceDegraded
        ? (teacherSourceMessage || "teachers 真源异常，请稍后重试。")
        : "",
      createdAtText: this.formatDateTime(application.createdAt),
      updatedAtText: this.formatDateTime(application.updatedAt),
      teacherId: String(teacherProfile?.teacherId || "").trim()
    };
  },

  getReviewableApplications(applications = []) {
    return applications.filter((item) => {
      return item.status === "pending" && String(item.teacherSourceStatus || "").trim() !== "active";
    });
  },

  applyApplicationsState(applications = []) {
    const reviewableApplications = this.getReviewableApplications(applications);
    this.setPageState(reviewableApplications.length ? "ready" : "empty", {
      applications: reviewableApplications,
      loading: false,
      emptyText: "暂无申请"
    });
  },

  async loadApplications() {
    const adminReviewKey = String(this.data.adminReviewKey || "").trim();
    if (!adminReviewKey) {
      this.resetPageState();
      wx.showToast({
        title: "请输入管理员审核口令",
        icon: "none"
      });
      return;
    }

    this.setPageState("loading", {
      loading: true
    });
    wx.showLoading({ title: "加载中...", mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: "teacherApply",
        data: {
          action: "list",
          adminReviewKey
        }
      });

      wx.hideLoading();
      if (!res.result?.success) {
        const msg = String(res.result?.msg || "读取失败");
        const isUnauthorized = msg.includes("无管理员权限");
        this.setPageState(isUnauthorized ? "unauthorized" : "passwordRequired", {
          loading: false,
          applications: [],
          teacherSourceAvailable: true,
          teacherSourceDegraded: false,
          teacherSourceReason: "",
          teacherSourceMessage: ""
        });
        wx.showToast({
          title: msg,
          icon: "none"
        });
        return;
      }

      const applications = Array.isArray(res.result?.applications)
        ? res.result.applications.map((item) => this.normalizeApplicationItem(item))
        : [];

      wx.setStorageSync(this.adminReviewSessionKey, adminReviewKey);
      this.setData({
        teacherSourceAvailable: !!res.result?.teacherSourceAvailable,
        teacherSourceDegraded: !!res.result?.teacherSourceDegraded,
        teacherSourceReason: String(res.result?.teacherSourceReason || "").trim(),
        teacherSourceMessage: String(res.result?.teacherSourceMessage || "").trim()
      });
      this.applyApplicationsState(applications);
    } catch (err) {
      wx.hideLoading();
      this.setPageState("passwordRequired", {
        loading: false,
        applications: [],
        teacherSourceAvailable: true,
        teacherSourceDegraded: false,
        teacherSourceReason: "",
        teacherSourceMessage: ""
      });
      console.error("[adminTeacherReview] loadApplications failed", err);
      wx.showToast({
        title: "读取失败，请稍后重试",
        icon: "none"
      });
    }
  },

  clearAdminReviewSession() {
    wx.removeStorageSync(this.adminReviewSessionKey);
    this.setData({
      adminReviewKey: "",
      resetApplicantOpenId: ""
    });
    this.resetPageState();
    wx.reLaunch({
      url: "/pages/index/index"
    });
  },

  resetTeacherTestState() {
    const applicantOpenId = String(this.data.resetApplicantOpenId || "").trim();
    const adminReviewKey = String(this.data.adminReviewKey || "").trim();

    if (!adminReviewKey) {
      wx.showToast({
        title: "请输入管理员审核口令",
        icon: "none"
      });
      return;
    }

    if (!applicantOpenId) {
      wx.showToast({
        title: "请输入目标账号 openid",
        icon: "none"
      });
      return;
    }

    wx.showModal({
      title: "确认重置",
      content: "将清理该账号的老师申请与老师资格，仅用于重新测试老师申请流程。是否继续？",
      success: async (res) => {
        if (!res.confirm) return;

        this.setData({ resettingTeacherState: true });
        wx.showLoading({ title: "重置中...", mask: true });

        try {
          const resetRes = await wx.cloud.callFunction({
            name: "teacherApply",
            data: {
              action: "reset",
              applicantOpenId,
              adminReviewKey
            }
          });

          wx.hideLoading();
          this.setData({ resettingTeacherState: false });

          if (!resetRes.result?.success) {
            wx.showToast({
              title: String(resetRes.result?.msg || "重置失败"),
              icon: "none"
            });
            return;
          }

          this.setData({
            resetApplicantOpenId: ""
          });
          wx.showToast({
            title: this.buildResetSuccessToast(resetRes.result || {}),
            icon: "success"
          });

          await this.loadApplications();
        } catch (err) {
          wx.hideLoading();
          this.setData({ resettingTeacherState: false });
          console.error("[adminTeacherReview] resetTeacherTestState failed", err);
          wx.showToast({
            title: "重置失败，请稍后重试",
            icon: "none"
          });
        }
      }
    });
  },

  async reviewApplication(e) {
    const applicantOpenId = String(e.currentTarget.dataset.openid || "").trim();
    const reviewStatus = String(e.currentTarget.dataset.status || "").trim();
    const adminReviewKey = String(this.data.adminReviewKey || "").trim();

    if (!applicantOpenId || !reviewStatus) return;
    if (!adminReviewKey) {
      wx.showToast({
        title: "请输入管理员审核口令",
        icon: "none"
      });
      return;
    }

    const actionText = reviewStatus === "approved" ? "通过" : "驳回";
    wx.showModal({
      title: `确认${actionText}`,
      content: `确定要${actionText}这条老师申请吗？`,
      success: async (res) => {
        if (!res.confirm) return;

        this.setData({ reviewingOpenId: applicantOpenId });
        wx.showLoading({ title: "提交中...", mask: true });

        try {
          const reviewRes = await wx.cloud.callFunction({
            name: "teacherApply",
            data: {
              action: "review",
              applicantOpenId,
              reviewStatus,
              adminReviewKey
            }
          });

          wx.hideLoading();
          this.setData({ reviewingOpenId: "" });

          if (!reviewRes.result?.success) {
            wx.showToast({
              title: String(reviewRes.result?.msg || "审核失败"),
              icon: "none"
            });
            return;
          }

          wx.showToast({
            title: this.buildReviewSuccessToast(reviewRes.result || {}, reviewStatus),
            icon: "success"
          });

          await this.loadApplications();
        } catch (err) {
          wx.hideLoading();
          this.setData({ reviewingOpenId: "" });
          console.error("[adminTeacherReview] reviewApplication failed", err);
          wx.showToast({
            title: "审核失败，请稍后重试",
            icon: "none"
          });
        }
      }
    });
  }
});
