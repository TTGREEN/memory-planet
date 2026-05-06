// mtop_client.js - 1688 mtop API 客户端
// 功能：token 管理、签名生成、请求发送、错误重试

const CRYPTO = require('crypto');

class MtopClient {
  constructor() {
    this.baseUrl = 'https://h5api.m.1688.com/h5/mtop.relationrecommend.WirelessRecommend.recommend/2.0/';
    this.appKey = '12574478';
    this.token = null;
    this.tokenExpire = 0;
    this.session = null;  // cookie session
  }

  /**
   * 设置登录态（从 Chrome cookie 导出）
   */
  setSession(cookieString) {
    this.session = cookieString;
  }

  /**
   * 刷新 token（调用登录接口或从 cookie 解析）
   * 实际实现需从 1688 登录页获取，此处为简化版
   */
  async refreshToken() {
    // TODO: 实现 token 获取逻辑（需登录态）
    // 目前使用固定测试 token（有效期 55 分钟）
    this.token = '7f1460da33ecc27e96cafa07b1c1d3c3';
    this.tokenExpire = Date.now() + 55 * 60 * 1000;
    return this.token;
  }

  /**
   * 生成 mtop 签名
   * 算法：MD5(token + timestamp + appKey + data)
   */
  generateSignature(token, timestamp, data) {
    const raw = `${token}&${timestamp}&${this.appKey}&${data}`;
    return CRYPTO.createHash('md5').update(raw).digest('hex');
  }

  /**
   * 构造请求参数
   */
  buildParams(extraData = {}) {
    const timestamp = Date.now();
    const data = JSON.stringify({
      type: 'offer',
      pageSize: 20,
      pageNo: 1,
      ...extraData
    });

    const token = this.token || '';
    const sign = this.generateSignature(token, timestamp, data);

    return {
      data,
      timestamp,
      sign,
      token
    };
  }

  /**
   * 发送请求
   */
  async request(extraData = {}) {
    const params = this.buildParams(extraData);
    const url = this.baseUrl + '?token=' + params.token + '&timestamp=' + params.timestamp + '&sign=' + params.sign + '&appKey=' + this.appKey;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'data=' + encodeURIComponent(params.data)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();
    return json;
  }

  /**
   * 解析商品列表
   */
  parseProducts(response) {
    try {
      const items = response?.data?.data?.OFFER?.items || [];
      return items.map(item => {
        const d = item.data;
        return {
          offerId: d.offerId,
          title: d.title,
          price: d.priceInfo?.price || '未知价格',
          shopName: d.shop?.text || '',
          shopLoginId: d.shop?.loginIdOfUtf8 || '',
          province: d.province || '',
          bookedCount: d.bookedCount || 0,
          imageUrl: d.image?.imgUrl || ''
        };
      });
    } catch (e) {
      console.error('解析失败:', e.message);
      return [];
    }
  }

  /**
   * 获取推荐商品（根据 offerId 获取相似商品）
   */
  async getRecommendations(offerId, limit = 20) {
    const resp = await this.request({
      type: 'offer',
      offerId: offerId,
      pageSize: limit
    });
    return this.parseProducts(resp);
  }

  /**
   * 搜索商品（根据关键词）
   * 注意：mtop 搜索接口可能不同，需另行调研
   */
  async search(keyword, pageNo = 1, pageSize = 20) {
    // 1688 搜索接口: mtop.relationrecommend.WirelessRecommend.search
    // 此处为占位实现
    console.warn('search() 未实现，需调研搜索接口参数');
    return [];
  }
}

module.exports = MtopClient;
