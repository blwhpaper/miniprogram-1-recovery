const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function getLessonAndRoster(lessonId) {
  const normalizedLessonId = String(lessonId || '').trim()

  if (!normalizedLessonId) {
    throw new Error('lessonId is required')
  }

  const lessonRes = await db.collection('lessons').doc(normalizedLessonId).get()
  const lesson = lessonRes.data
  console.log('[bindStudent] lesson =', lesson)

  if (!lesson) {
    throw new Error('lesson not found')
  }

  const classId = String(lesson.classId || '').trim()
  console.log('[bindStudent] classId =', classId)
  if (!classId) {
    throw new Error('lesson class is invalid')
  }

  const classRes = await db.collection('classes').doc(classId).get()
  const classInfo = classRes.data
  const roster = Array.isArray(classInfo?.roster) ? classInfo.roster : []
  console.log('[bindStudent] roster sample =', roster.slice(0, 5))

  return {
    lessonId: normalizedLessonId,
    classId,
    roster
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  console.log('[bindStudent] raw event', event)
  const studentId = String(event.studentId || '').trim()
  const name = String(event.name || '').trim()
  const lessonId = String(event.lessonId || '').trim()
  console.log('[bindStudent] normalized input', { lessonId, studentId, name })
  console.log('[bindStudent] input', { lessonId, studentId, name })

  if (!name) {
    return {
      success: false,
      msg: '请输入姓名'
    }
  }

  if (!studentId) {
    return {
      success: false,
      msg: '请输入学号'
    }
  }

  if (!lessonId) {
    return {
      success: false,
      msg: '缺少当前签到课信息，请重新扫码'
    }
  }

  try {
    const { classId, roster } = await getLessonAndRoster(lessonId)
    const normalizedName = String(name || '').trim()
    const normalizedStudentId = String(studentId || '').trim()
    const hasMatchedName = roster.some(
      (student) => String(student.name || '').trim() === normalizedName
    )
    const hasMatchedStudentId = roster.some(
      (student) => String(student.studentId || '').trim() === normalizedStudentId
    )
    const isInCurrentClassRoster = roster.some((student) => (
      String(student.studentId || '').trim() === normalizedStudentId &&
      String(student.name || '').trim() === normalizedName
    ))
    console.log('[bindStudent] match result =', {
      lessonId,
      classId,
      studentId,
      name,
      hasMatchedName,
      hasMatchedStudentId,
      matched: isInCurrentClassRoster
    })

    if (!isInCurrentClassRoster) {
      if (!hasMatchedName) {
        return {
          success: false,
          msg: '该姓名不在当前班级名单中'
        }
      }

      if (!hasMatchedStudentId) {
        return {
          success: false,
          msg: '该学号不在当前班级名单中'
        }
      }

      return {
        success: false,
        msg: '姓名与学号不匹配，请输入本人信息'
      }
    }

    const userRes = await db.collection('users').where({
      _openid: OPENID
    }).limit(2).get()

    const existingUser = (userRes.data || [])[0]

    if (existingUser && existingUser.bound) {
      const isSameStudent =
        String(existingUser.studentId || '').trim() === studentId &&
        String(existingUser.name || '').trim() === name &&
        existingUser.role === 'student'

      if (!isSameStudent) {
        return {
          success: false,
          msg: '当前微信号已绑定其他学生身份'
        }
      }

      return {
        success: true,
        msg: '已完成绑定',
        user: {
          _openid: OPENID,
          role: 'student',
          studentId,
          name,
          bound: true,
          lessonId,
          classId
        }
      }
    }

    const userData = {
      role: 'student',
      studentId,
      name,
      bound: true,
      bindTime: db.serverDate()
    }

    if (existingUser) {
      await db.collection('users').doc(existingUser._id).update({
        data: userData
      })
    } else {
      await db.collection('users').add({
        data: {
          _openid: OPENID,
          ...userData
        }
      })
    }

    return {
      success: true,
      msg: '绑定成功',
      user: {
        _openid: OPENID,
        role: 'student',
        studentId,
        name,
        bound: true,
        lessonId,
        classId
      }
    }
  } catch (err) {
    return {
      success: false,
      msg: '系统错误: ' + err.message
    }
  }
}
