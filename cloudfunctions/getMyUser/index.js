const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function resolveStudentClassId(user = {}) {
  const directClassId = String(user.classId || '').trim()
  if (directClassId) {
    return directClassId
  }

  const lessonId = String(user.lessonId || '').trim()
  if (lessonId) {
    try {
      const lessonRes = await db.collection('lessons').doc(lessonId).get()
      const lessonClassId = String(lessonRes.data?.classId || '').trim()
      if (lessonClassId) {
        return lessonClassId
      }
    } catch (err) {}
  }

  const studentId = String(user.studentId || '').trim()
  if (studentId) {
    try {
      const attendanceRes = await db.collection('attendance')
        .where({ studentId })
        .limit(1)
        .get()
      const attendanceClassId = String(attendanceRes.data?.[0]?.classId || '').trim()
      if (attendanceClassId) {
        return attendanceClassId
      }
    } catch (err) {}
  }

  return ''
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()

  try {
    const res = await db.collection('users').where({
      _openid: OPENID
    }).limit(1).get()

    const user = (res.data || [])[0]

    if (!user || !user.bound) {
      return {
        success: true,
        bound: false,
        user: null,
        msg: '未绑定学生身份'
      }
    }

    const classId = await resolveStudentClassId(user)

    return {
      success: true,
      bound: true,
      user: {
        _openid: user._openid || OPENID,
        role: user.role,
        studentId: user.studentId,
        name: user.name,
        classId,
        lessonId: user.lessonId || '',
        bound: !!user.bound,
        bindTime: user.bindTime || null
      }
    }
  } catch (err) {
    return {
      success: false,
      bound: false,
      user: null,
      msg: '系统错误: ' + err.message
    }
  }
}
