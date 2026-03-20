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
    const classId = options.id
    const latestLessonId = String(wx.getStorageSync(`LATEST_LESSON_${classId}`) || "").trim()
    this.setData({
      classId,
      lessonId: options.lessonId || latestLessonId || ""
    })
    this.refreshCount()
  },

  onShow() {
    const latestLessonId = this.getLatestLessonId()
    if (latestLessonId && latestLessonId !== this.data.lessonId) {
      console.log("[studentList] refresh latest lessonId", {
        classId: this.data.classId,
        previousLessonId: this.data.lessonId,
        latestLessonId
      })
      this.setData({ lessonId: latestLessonId })
    }
  },

  refreshCount() {
    let list = wx.getStorageSync("students_" + this.data.classId) || []
    this.setData({ studentCount: list.length })
  },

  syncRosterToCloud(roster) {
    console.log("[studentList] sync roster to cloud", {
      classId: this.data.classId,
      rosterCount: roster.length
    })
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
              wx.setStorageSync("students_" + this.data.classId, arr)

              const syncRes = await this.syncRosterToCloud(arr)
              console.log("[studentList] sync roster result", syncRes.result)
              if (!syncRes.result || !syncRes.result.success) {
                throw new Error(syncRes.result?.msg || "云端同步失败")
              }

              this.refreshCount()
              wx.hideLoading()
              wx.showToast({ title: "上传并同步成功", icon: "success" })
            } catch (err) {
              wx.hideLoading()
              console.error("同步学生名单失败：", err)
              wx.showModal({
                title: "同步失败",
                content: err.message || "本地保存成功，但云端同步失败",
                showCancel: false
              })
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
  }
})
