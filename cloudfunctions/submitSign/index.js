const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const lessonId = String(event.lessonId || '').trim()
  const { OPENID } = cloud.getWXContext()

  if (!lessonId) {
    return {
      success: false,
      msg: 'lessonId is required'
    }
  }

  try {
    const userRes = await db.collection('users').where({
      _openid: OPENID
    }).limit(1).get()
    const user = (userRes.data || [])[0]

    if (!user || !user.bound || user.role !== 'student') {
      return {
        success: false,
        msg: '请先绑定学生身份'
      }
    }

    const lessonRes = await db.collection('lessons').doc(lessonId).get()
    const lesson = lessonRes.data
    console.log('[submitSign] user', user)
    console.log('[submitSign] lesson', lesson)

    if (!lesson || lesson.status !== 'active') {
      return {
        success: false,
        msg: 'Sign-in is currently closed for this lesson'
      }
    }

    if (!lesson.classId) {
      return {
        success: false,
        msg: 'Lesson class is invalid'
      }
    }

    const classId = String(lesson.classId || '').trim()
    const classRes = await db.collection('classes').doc(classId).get()
    const classInfo = classRes.data
    const roster = Array.isArray(classInfo?.roster) ? classInfo.roster : []
    const isInRoster = roster.some((student) => {
      return (
        String(student.studentId || '').trim() === String(user.studentId || '').trim() &&
        String(student.name || '').trim() === String(user.name || '').trim()
      )
    })

    if (!isInRoster) {
      return {
        success: false,
        msg: '当前绑定学生不在本班级名单中'
      }
    }

    const existing = await db.collection('attendance').where({
      lessonId: lessonId,
      studentId: String(user.studentId || '').trim()
    }).limit(1).get()

    if (existing.data.length > 0) {
      const existedDoc = existing.data[0] || {}
      const existedStatus = String(existedDoc.status || existedDoc.attendanceStatus || '').trim()
      if (existedStatus === 'unsigned') {
        await db.collection('attendance').doc(existedDoc._id).update({
          data: {
            studentOpenid: OPENID,
            signTime: db.serverDate(),
            status: 'signed',
            attendanceStatus: 'signed'
          }
        })

        return {
          success: true,
          msg: 'Sign-in successful'
        }
      }
      const statusMsgMap = {
        signed: '你已完成签到',
        leave_agree: '当前已请假',
        leave_wait: '当前请假待确认',
        absent: '当前已被老师标记为旷课'
      }
      return {
        success: false,
        msg: statusMsgMap[existedStatus] || '当前签到状态已存在'
      }
    }

    const attendancePayload = {
      lessonId: lessonId,
      classId,
      studentOpenid: OPENID,
      studentId: user.studentId,
      studentName: user.name,
      signTime: db.serverDate(),
      status: 'signed'
    }
    console.log("[submitSign] write attendance", {
      lessonId: attendancePayload.lessonId,
      classId: attendancePayload.classId,
      studentId: attendancePayload.studentId,
      studentName: attendancePayload.studentName,
      studentOpenid: attendancePayload.studentOpenid,
      status: attendancePayload.status
    })

    await db.collection('attendance').add({
      data: attendancePayload
    })

    return {
      success: true,
      msg: 'Sign-in successful'
    }
  } catch (err) {
    return {
      success: false,
      msg: 'System error: ' + err.message
    }
  }
}
