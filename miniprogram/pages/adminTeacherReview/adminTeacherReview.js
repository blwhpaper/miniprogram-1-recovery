Page({
  data: {
    adminReviewKey: "",
    applications: [],
    loading: false,
    reviewingOpenId: "",
    emptyText: "请输入管理员审核口令后读取申请列表。"
  },

  onLoad() {},

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
      wx.showToast({
        title: "请输入管理员审核口令",
        icon: "none"
      });
      return;
    }

    this.setData({ loading: true });
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
        wx.showToast({
          title: String(res.result?.msg || "读取失败"),
          icon: "none"
        });
        this.setData({
          loading: false
        });
        return;
      }

      const applications = Array.isArray(res.result?.applications)
        ? res.result.applications.map((item) => this.normalizeApplicationItem(item))
        : [];

      this.setData({
        applications,
        loading: false,
        emptyText: applications.length ? "" : "当前没有老师申请记录。"
      });
    } catch (err) {
      wx.hideLoading();
      this.setData({ loading: false });
      console.error("[adminTeacherReview] loadApplications failed", err);
      wx.showToast({
        title: "读取失败，请稍后重试",
        icon: "none"
      });
    }
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
