const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { classId } = event
  const { OPENID } = cloud.getWXContext()

  if (!classId) {
    return {
      success: false,
      msg: 'classId is required'
    }
  }

  try {
    const result = await db.collection('lessons').add({
      data: {
        classId: classId,
        teacherOpenid: OPENID,
        startTime: db.serverDate(),
        status: 'active'
      }
    })

    return {
      success: true,
      lessonId: result._id,
      msg: 'Lesson started successfully'
    }
  } catch (err) {
    return {
      success: false,
      msg: err.message
    }
  }
}