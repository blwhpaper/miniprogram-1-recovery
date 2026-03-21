Page({
  data: {
    classId: "",
    lessonId: "",
    qrcode: ""
  },

  onLoad(options) {
    const classId = String(options.classId || options.id || "").trim()
    console.log("[classHome] onLoad classId", {
      classId,
      options
    })

    this.setData({
      classId
    })
  },

  /**
   * 核心重构：生成签到码流程
   * 1. 调用云函数创建本次课程（Lesson）
   * 2. 使用返回的 lessonId 生成唯一签到码
   */
  async createSignCode() {
    const classId = String(this.data.classId || "").trim()
    console.log("[classHome] createSignCode classId", classId)

    if (!classId) {
      wx.showToast({ title: "请先选择班级", icon: "none" })
      return
    }

    wx.showLoading({ title: "正在开启签到...", mask: true })

    try {
      // 第一步：在云端创建一节“课”（Lesson），获取唯一 ID
      console.log("[classHome] createLesson classId =", classId)
      const lessonRes = await wx.cloud.callFunction({
        name: "createLesson",
        data: { classId }
      })
      console.log("[classHome] createLesson result =", lessonRes)
      console.log("[classHome] returned lessonId =", lessonRes.result?.lessonId)

      if (!lessonRes.result || !lessonRes.result.success) {
        throw new Error(lessonRes.result?.msg || "创建课程失败")
      }

      const lessonId = String(lessonRes.result?.lessonId || "").trim()
      if (!lessonId) {
        throw new Error("创建课程成功但未返回 lessonId")
      }
      console.log("[classHome] created lessonId", lessonId)
      wx.setStorageSync(`LATEST_LESSON_${classId}`, lessonId)
      this.setData({ lessonId })

      // 第二步：使用 lessonId 生成二维码（云端鉴权并绑定参数）
      const qrRes = await wx.cloud.callFunction({
        name: "createSignCode",
        data: { lessonId: lessonId }
      })
      console.log("[classHome] createSignCode result", {
        lessonId,
        success: qrRes.result?.success,
        page: qrRes.result?.page,
        scene: qrRes.result?.scene,
        envVersion: qrRes.result?.envVersion
      })

      if (!qrRes.result || !qrRes.result.success || !qrRes.result.buffer) {
        throw new Error(qrRes.result?.err?.message || "生成签到码失败")
      }

      const base64 = wx.arrayBufferToBase64(qrRes.result.buffer)
      const imgUrl = "data:image/png;base64," + base64

      this.setData({ qrcode: imgUrl })
      wx.hideLoading()
      wx.showToast({ title: "签到已开启", icon: "success" })

    } catch (err) {
      wx.hideLoading()
      console.error("签到开启失败：", err)
      wx.showModal({
        title: "错误",
        content: err.message || "无法生成签到码，请检查网络",
        showCancel: false
      })
    }
  },

  // 跳转到学生名单管理（修复：带上 classId）
  goToStudentList() {
    const classId = String(this.data.classId || "").trim()
    const latestLessonId = String(
      this.data.lessonId || wx.getStorageSync(`LATEST_LESSON_${classId}`) || ""
    ).trim()
    wx.navigateTo({
      url: `/pages/studentList/studentList?id=${classId}&lessonId=${latestLessonId}`
    })
  }
})
