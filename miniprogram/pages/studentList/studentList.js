Page({
  data: {
    classId: "",
    lessonId: "",
    studentCount: 0
  },

  getLatestLessonId() {
    return String(wx.getStorageSync(`LATEST_LESSON_${this.data.classId}`) || "").trim()
  },

  normalizeRosterItem(student = {}) {
    return {
      name: String(student.name || "").trim(),
      studentId: String(student.studentId || student.id || "").trim()
    }
  },

  onLoad(options) {
    const classId = String(options.id || "").trim()
    const latestLessonId = String(wx.getStorageSync(`LATEST_LESSON_${classId}`) || "").trim()
    const incomingLessonId = String(options.lessonId || "").trim()
    this.setData({
      classId,
      lessonId: latestLessonId || incomingLessonId || ""
    })
    this.refreshCount()
  },

  onShow() {
    const latestLessonId = this.getLatestLessonId()
    if (latestLessonId && latestLessonId !== this.data.lessonId) {
      this.setData({ lessonId: latestLessonId })
    }
  },

  async refreshCount() {
    const classId = String(this.data.classId || "").trim()
    if (!classId) {
      this.setData({ studentCount: 0 })
      return
    }

    try {
      const db = wx.cloud.database()
      const res = await db.collection("classes").doc(classId).get()
      const roster = Array.isArray(res.data?.roster) ? res.data.roster : []
      this.setData({ studentCount: roster.length })
    } catch (err) {
      this.setData({ studentCount: 0 })
      console.error("[studentList] refresh cloud count failed", err)
    }
  },

  syncRosterToCloud(roster) {
    return wx.cloud.callFunction({
      name: "syncClassRoster",
      data: {
        classId: this.data.classId,
        roster
      }
    })
  },

  uploadCSV() {
    wx.chooseMessageFile({
      type: "file",
      success: (res) => {
        const classId = String(this.data.classId || "").trim()
        if (!classId) {
          wx.showToast({ title: "班级ID无效", icon: "none" })
          return
        }

        const fs = wx.getFileSystemManager()
        fs.readFile({
          filePath: res.tempFiles[0].path,
          encoding: "utf-8",
          success: async (result) => {
            let lines = result.data.split(/\r?\n/)
            let arr = []
            for (let i = 1; i < lines.length; i++) {
              let line = lines[i].trim()
              if (!line) continue
              let p = line.split(",")
              const normalizedItem = this.normalizeRosterItem({
                name: p[0],
                studentId: p[1]
              })
              if (!normalizedItem.name || !normalizedItem.studentId) continue
              arr.push(normalizedItem)
            }

            if (arr.length === 0) {
              wx.showToast({ title: "名单为空或格式错误", icon: "none" })
              return
            }

            wx.showLoading({ title: "同步名单中...", mask: true })

            try {
              const syncRes = await this.syncRosterToCloud(arr)
              if (!syncRes.result || !syncRes.result.success) {
                throw new Error(syncRes.result?.msg || "云端同步失败")
              }

              wx.setStorageSync("students_" + classId, arr)
              await this.refreshCount()
              wx.showToast({ title: "上传并同步成功", icon: "success" })
            } catch (err) {
              console.error("同步学生名单失败：", err)
              wx.showModal({
                title: "同步失败",
                content: err.message || "云端同步失败，请稍后重试",
                showCancel: false
              })
            } finally {
              wx.hideLoading()
            }
          }
        })
      }
    })
  },

  // ======================
  // 【修复：带 classId 跳转】
  // ======================
  goSignRecord() {
    const latestLessonId = this.getLatestLessonId()
    const lessonId = latestLessonId || this.data.lessonId

    if (!lessonId) {
      wx.showToast({ title: "请先生成签到码", icon: "none" })
      return
    }

    this.setData({ lessonId })
    wx.navigateTo({
      url: `/pages/signRecord/signRecord?classId=${this.data.classId}&lessonId=${lessonId}`
    })
  },

  goClassInteraction() {
    const latestLessonId = this.getLatestLessonId()
    const lessonId = latestLessonId || this.data.lessonId

    if (!lessonId) {
      wx.showToast({ title: "请先生成签到码", icon: "none" })
      return
    }

    this.setData({ lessonId })
    wx.navigateTo({
      url: `/pages/classInteraction/classInteraction?classId=${this.data.classId}&lessonId=${lessonId}`
    })
  }
})
