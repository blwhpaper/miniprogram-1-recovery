Page({
  data: {
    classList: []
  },

  onLoad() {
    this.ensureTeacherSession()
    this.loadClasses()
  },

  ensureTeacherSession() {
    const currentTeacher = String(wx.getStorageSync("CURRENT_TEACHER") || "").trim()
    if (currentTeacher) return currentTeacher

    const fallbackTeacher = "default"
    wx.setStorageSync("CURRENT_TEACHER", fallbackTeacher)
    return fallbackTeacher
  },

  // 按当前老师加载班级（数据隔离）
  loadClasses() {
    let teacher = this.ensureTeacherSession()
    let list = wx.getStorageSync("CLASS_LIST_" + teacher) || [
      { id: "C1", name: "智控2501" },
      { id: "C2", name: "智控2502" },
      { id: "C3", name: "智控2503" }
    ]
    this.setData({ classList: list })
  },

  // 保存（按老师隔离）
  saveClasses(list) {
    let teacher = this.ensureTeacherSession()
    wx.setStorageSync("CLASS_LIST_" + teacher, list)
    this.setData({ classList: list })
  },

  // 进入班级
  enterClass(e) {
    let id = e.currentTarget.dataset.id
    wx.navigateTo({
      url: "/pages/classHome/classHome?id=" + id
    })
  },

  // 新建班级（重名检测）
  addClass() {
    wx.showModal({
      title: "新建班级",
      editable: true,
      placeholderText: "班级名称",
      success: (res) => {
        if (!res.confirm || !res.content) return
        let newName = res.content.trim()

        // 重名判断
        let exist = this.data.classList.some(i => i.name === newName)
        if (exist) {
          wx.showToast({ title: "班级名已存在", icon: "none" })
          return
        }

        let newClass = {
          id: "CLASS_" + Date.now(),
          name: newName
        }
        let newList = [...this.data.classList, newClass]
        this.saveClasses(newList)
      }
    })
  },

  // 删除班级
  deleteClass(e) {
    let id = e.currentTarget.dataset.id
    let newList = this.data.classList.filter(i => i.id !== id)
    this.saveClasses(newList)
  }
})
