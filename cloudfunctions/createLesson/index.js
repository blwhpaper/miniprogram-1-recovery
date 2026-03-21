const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { classId } = event
  const { OPENID } = cloud.getWXContext()
  console.log("[createLesson] classId =", classId)

  if (!classId) {
    return {
      success: false,
      msg: 'classId is required'
    }
  }

  try {
    console.log("[createLesson] input classId =", classId)
    const addRes = await db.collection('lessons').add({
      data: {
        classId: classId,
        teacherOpenid: OPENID,
        startTime: db.serverDate(),
        status: 'active'
      }
    })
    console.log("[createLesson] add result =", addRes)
    console.log("[createLesson] return lessonId =", addRes._id)

    return {
      success: true,
      lessonId: addRes._id,
      msg: 'Lesson started successfully'
    }
  } catch (err) {
    return {
      success: false,
      msg: err.message
    }
  }
}
