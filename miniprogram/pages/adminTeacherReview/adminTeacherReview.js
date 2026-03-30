Page({
  adminReviewSessionKey: "ADMIN_REVIEW_KEY",

  data: {
    adminReviewKey: "",
    applications: [],
    loading: false,
    reviewingOpenId: "",
    emptyText: "暂无待审核数据",
    pageState: "passwordRequired",
    stateTitle: "需要管理员审核口令",
    stateDescription: "请输入管理员审核口令后读取申请列表。"
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
        stateTitle: "正在加载审核数据",
        stateDescription: "正在校验当前审核权限并读取申请列表。"
      },
      unauthorized: {
        stateTitle: "当前无权限",
        stateDescription: "当前账号或口令未通过管理员校验，无法查看和审核老师申请。"
      },
      passwordRequired: {
        stateTitle: "需要管理员审核口令",
        stateDescription: "请输入管理员审核口令后读取申请列表。"
      },
      empty: {
        stateTitle: "暂无待审核数据",
        stateDescription: "当前已通过管理员校验，但暂时没有可处理的老师申请。"
      },
      ready: {
        stateTitle: "可正常审核",
        stateDescription: "当前已通过管理员校验，可查看申请列表并执行通过或驳回。"
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
      reviewingOpenId: "",
      emptyText: "暂无待审核数据"
    });
  },

  inputAdminReviewKey(e) {
    this.setData({
      adminReviewKey: String(e.detail.value || "").trim()
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

  normalizeApplicationItem(item = {}) {
    const application = item.application || {};
    const teacherProfile = item.teacherProfile || null;
    const status = String(application.status || "").trim();
    return {
      applicantOpenId: String(application.applicantOpenId || item._openid || "").trim(),
      applicantName: String(application.applicantName || "").trim() || "-",
      contactInfo: String(application.contactInfo || "").trim() || "-",
      remark: String(application.remark || "").trim() || "无",
      status,
      statusText: this.getStatusText(status),
      createdAtText: this.formatDateTime(application.createdAt),
      updatedAtText: this.formatDateTime(application.updatedAt),
      teacherId: String(teacherProfile?.teacherId || "").trim()
    };
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
          applications: []
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

      this.setPageState(applications.length ? "ready" : "empty", {
        applications,
        loading: false,
        emptyText: "暂无待审核数据"
      });
    } catch (err) {
      wx.hideLoading();
      this.setPageState("passwordRequired", {
        loading: false,
        applications: []
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
      adminReviewKey: ""
    });
    this.resetPageState();
    wx.reLaunch({
      url: "/pages/index/index"
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
            title: reviewStatus === "approved" ? "审核通过" : "已驳回",
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
