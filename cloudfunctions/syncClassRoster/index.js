const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function normalizeRoster(roster = []) {
  if (!Array.isArray(roster)) return []

  return roster
    .map((student = {}) => ({
      name: String(student.name || '').trim(),
      studentId: String(student.studentId || student.id || '').trim()
    }))
    .filter((student) => student.name && student.studentId)
}

exports.main = async (event) => {
  const classId = String(event.classId || '').trim()
  const roster = normalizeRoster(event.roster || [])
  const { OPENID } = cloud.getWXContext()

  if (!classId) {
    return {
      success: false,
      msg: 'classId is required'
    }
  }

  try {
    const classRef = db.collection('classes').doc(classId)
    const payload = {
      classId,
      roster,
      updateTime: db.serverDate(),
      teacherOpenid: OPENID
    }
    console.log("[syncClassRoster] write class roster", {
      classId,
      rosterCount: roster.length,
      teacherOpenid: OPENID
    })

    await classRef.set({
      data: payload
    })

    return {
      success: true,
      classId,
      rosterCount: roster.length
    }
  } catch (err) {
    return {
      success: false,
      msg: '同步班级名单失败: ' + err.message
    }
  }
}
