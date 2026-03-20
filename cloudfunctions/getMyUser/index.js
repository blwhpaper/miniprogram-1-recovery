const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

    return {
      success: true,
      bound: true,
      user: {
        _openid: user._openid || OPENID,
        role: user.role,
        studentId: user.studentId,
        name: user.name,
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
