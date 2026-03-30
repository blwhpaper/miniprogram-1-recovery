Page({
  data: {
    applicantName: "",
    contactInfo: "",
    remark: "",
    applicationStatus: "",
    applicationStatusText: "未申请",
    applicationSummaryText: "请填写最小资料并提交老师注册申请。",
    submitDisabled: false,
    hasTeacherSession: false
  },

  onLoad() {
    this.loadApplicationState();
  },

  onShow() {
    this.loadApplicationState();
  },

  getApplicationStatusText(status = "") {
    const normalizedStatus = String(status || "").trim();
    const map = {
      pending: "待审核",
      approved: "已开通",
      rejected: "未通过"
    };
    return map[normalizedStatus] || "未申请";
  },

  async loadApplicationState() {
    this.setData({
      hasTeacherSession: false
    });

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
      const isTeacher = !!res.result?.isTeacher && !!String(teacherProfile?.teacherId || "").trim();

      if (isTeacher) {
        this.setData({
          hasTeacherSession: true,
          applicationStatus: "approved",
          applicationStatusText: "已开通",
          applicationSummaryText: "当前账号已具备教师身份，无需重复提交申请。",
          submitDisabled: true
        });
        return;
      }

      this.setData({
        applicantName: String(application?.applicantName || ""),
        contactInfo: String(application?.contactInfo || ""),
        remark: String(application?.remark || ""),
        applicationStatus: status,
        applicationStatusText: this.getApplicationStatusText(status),
        applicationSummaryText: isPending
          ? "已提交，等待审核"
          : status === "approved"
            ? "当前申请已通过，后续可接入教师身份开通。"
            : status === "rejected"
              ? "当前申请未通过，可修改后重新提交。"
              : "请填写最小资料并提交老师注册申请。",
        submitDisabled: isPending
      });
    } catch (err) {
      console.error("[teacherApply] load application state failed", err);
      wx.showToast({
        title: "申请状态读取失败",
        icon: "none"
      });
    }
  },

  inputApplicantName(e) {
    this.setData({
      applicantName: String(e.detail.value || "").trim()
    });
  },

  inputContactInfo(e) {
    this.setData({
      contactInfo: String(e.detail.value || "").trim()
    });
  },

  inputRemark(e) {
    this.setData({
      remark: String(e.detail.value || "").trim()
    });
  },

  async submitTeacherApply() {
    if (this.data.submitDisabled) {
      wx.showToast({
        title: "已提交，等待审核",
        icon: "none"
      });
      return;
    }

    const applicantName = String(this.data.applicantName || "").trim();
    const contactInfo = String(this.data.contactInfo || "").trim();
    const remark = String(this.data.remark || "").trim();

    if (!applicantName) {
      wx.showToast({
        title: "请输入姓名",
        icon: "none"
      });
      return;
    }

    if (!contactInfo) {
      wx.showToast({
        title: "请输入联系方式",
        icon: "none"
      });
      return;
    }

    wx.showLoading({
      title: "提交中...",
      mask: true
    });

    try {
      const res = await wx.cloud.callFunction({
        name: "teacherApply",
        data: {
          action: "submit",
          applicantName,
          contactInfo,
          remark
        }
      });

      wx.hideLoading();

      if (!res.result?.success) {
        wx.showToast({
          title: String(res.result?.msg || "提交失败"),
          icon: "none"
        });
        return;
      }

      const alreadySubmitted = !!res.result?.alreadySubmitted;
      wx.showToast({
        title: alreadySubmitted ? "已提交，等待审核" : "提交成功",
        icon: "success"
      });

      await this.loadApplicationState();
    } catch (err) {
      wx.hideLoading();
      console.error("[teacherApply] submit teacher apply failed", err);
      wx.showToast({
        title: "提交失败，请稍后重试",
        icon: "none"
      });
    }
  }
});
