import type { DayEntry, JourneyPlace } from './types';
import type { AiTravelPlan } from './planner-types';
import { plannerJournalVisitFor } from './planner-journal';
import { loadTicketsFromStorage, type TravelTicket } from './ticket-wallet';
import { isActivityTimePassed } from './planner-auto-visit';

export type ScenicCategory =
  | '5a'
  | 'heritage-cultural'
  | 'heritage-natural'
  | 'heritage-mixed';

export interface ScenicSpot {
  id: string;
  name: string;
  provinceCode: string;
  provinceName: string;
  city?: string;
  category: ScenicCategory;
  aliases?: string[];
}

export interface ScenicManualRecord {
  visited: boolean;
  updatedAt: string;
}

export type ScenicManualMap = Record<string, ScenicManualRecord>;

export interface ScenicVisitInfo {
  spot: ScenicSpot;
  visited: boolean;
  source: 'auto' | 'manual' | null;
  matchedFrom?: 'plan' | 'journal' | 'ticket';
  matchedText?: string;
  date?: string;
}

export interface ProvinceScenicSummary {
  provinceCode: string;
  provinceName: string;
  fiveATotal: number;
  fiveAVisited: number;
  heritageTotal: number;
  heritageVisited: number;
  heritageCulturalTotal: number;
  heritageCulturalVisited: number;
  heritageNaturalTotal: number;
  heritageNaturalVisited: number;
  heritageMixedTotal: number;
  heritageMixedVisited: number;
  spots: ScenicVisitInfo[];
  autoMatchedSpots: ScenicVisitInfo[];
}

export interface ScenicProgressReport {
  items: ScenicVisitInfo[];
  byId: Map<string, ScenicVisitInfo>;
  byProvince: Map<string, ProvinceScenicSummary>;
  provinces: ProvinceScenicSummary[];
  totals: {
    fiveA: { visited: number; total: number };
    heritageAll: { visited: number; total: number };
    heritageCultural: { visited: number; total: number };
    heritageNatural: { visited: number; total: number };
    heritageMixed: { visited: number; total: number };
  };
}

export const SCENIC_MANUAL_STORAGE_KEY = 'zhouyou-scenic-manual-v1';
export const SCENIC_MANUAL_CHANGED_EVENT = 'zhouyou-scenic-manual-changed';

export function readScenicManualMap(): ScenicManualMap {
  try {
    const raw = localStorage.getItem(SCENIC_MANUAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ScenicManualMap;
  } catch {
    return {};
  }
}

export function writeScenicManualMap(map: ScenicManualMap): void {
  try {
    localStorage.setItem(SCENIC_MANUAL_STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(SCENIC_MANUAL_CHANGED_EVENT));
  } catch {
    /* ignore quota errors */
  }
}

export function toggleScenicManualVisit(spotId: string, nextVisited: boolean): ScenicManualMap {
  const prev = readScenicManualMap();
  const next: ScenicManualMap = {
    ...prev,
    [spotId]: { visited: nextVisited, updatedAt: new Date().toISOString() },
  };
  writeScenicManualMap(next);
  return next;
}

type RawSpotTuple = [name: string, city?: string, aliases?: string[]];

const PROVINCE_NAMES: Record<string, string> = {
  '110000': '北京',
  '120000': '天津',
  '130000': '河北',
  '140000': '山西',
  '150000': '内蒙古',
  '210000': '辽宁',
  '220000': '吉林',
  '230000': '黑龙江',
  '310000': '上海',
  '320000': '江苏',
  '330000': '浙江',
  '340000': '安徽',
  '350000': '福建',
  '360000': '江西',
  '370000': '山东',
  '410000': '河南',
  '420000': '湖北',
  '430000': '湖南',
  '440000': '广东',
  '450000': '广西',
  '460000': '海南',
  '500000': '重庆',
  '510000': '四川',
  '520000': '贵州',
  '530000': '云南',
  '540000': '西藏',
  '610000': '陕西',
  '620000': '甘肃',
  '630000': '青海',
  '640000': '宁夏',
  '650000': '新疆',
  '820000': '澳门',
};

/** 国家 5A 级旅游景区名录（按省整理，含常用简称/别名以便自动匹配行程与手账）。 */
const RAW_5A_BY_PROVINCE: Record<string, RawSpotTuple[]> = {
  '110000': [
    ['故宫博物院', '北京', ['故宫', '紫禁城']],
    ['天坛公园', '北京', ['天坛']],
    ['颐和园', '北京'],
    ['八达岭—慕田峪长城', '北京', ['八达岭长城', '慕田峪长城', '八达岭', '慕田峪']],
    ['明十三陵', '北京', ['十三陵', '定陵', '长陵']],
    ['恭王府', '北京'],
    ['北京奥林匹克公园', '北京', ['奥林匹克公园', '鸟巢', '水立方']],
    ['圆明园景区', '北京', ['圆明园']],
    ['北京（通州）大运河文化旅游景区', '北京', ['通州大运河']],
  ],
  '120000': [
    ['天津古文化街旅游区', '天津', ['古文化街', '津门故里']],
    ['天津盘山风景名胜区', '天津', ['盘山']],
  ],
  '130000': [
    ['承德避暑山庄及周围寺庙景区', '承德', ['避暑山庄', '承德避暑山庄']],
    ['秦皇岛山海关景区', '秦皇岛', ['山海关', '老龙头', '天下第一关']],
    ['安新白洋淀景区', '保定', ['白洋淀']],
    ['野三坡景区', '保定', ['野三坡']],
    ['西柏坡景区', '石家庄', ['西柏坡']],
    ['清东陵景区', '唐山', ['清东陵']],
    ['清西陵景区', '保定', ['清西陵']],
    ['娲皇宫景区', '邯郸', ['娲皇宫']],
    ['广府古城景区', '邯郸', ['广府古城']],
    ['白石山景区', '保定', ['白石山']],
    ['金山岭长城景区', '承德', ['金山岭长城', '金山岭']],
    ['南湖·开滦旅游景区', '唐山', ['唐山南湖', '开滦国家矿山公园']],
  ],
  '140000': [
    ['云冈石窟', '大同'],
    ['五台山风景名胜区', '忻州', ['五台山']],
    ['平遥古城', '晋中'],
    ['皇城相府生态文化旅游区', '晋城', ['皇城相府']],
    ['绵山景区', '晋中', ['绵山']],
    ['雁门关景区', '忻州', ['雁门关']],
    ['洪洞大槐树寻根祭祖园', '临汾', ['洪洞大槐树', '大槐树']],
    ['黄河壶口瀑布旅游区（山西）', '临汾', ['壶口瀑布']],
    ['云丘山景区', '临汾', ['云丘山']],
    ['太行山大峡谷八泉峡景区', '长治', ['八泉峡', '太行山大峡谷']],
  ],
  '150000': [
    ['响沙湾旅游景区', '鄂尔多斯', ['响沙湾']],
    ['成吉思汗陵旅游区', '鄂尔多斯', ['成吉思汗陵']],
    ['满洲里中俄边境旅游区', '呼伦贝尔', ['满洲里套娃广场', '满洲里国门']],
    ['阿尔山·柴河旅游景区', '兴安盟', ['阿尔山', '阿尔山国家森林公园']],
    ['阿斯哈图石阵旅游区', '赤峰', ['阿斯哈图石林', '阿斯哈图']],
    ['额济纳胡杨林旅游区', '阿拉善盟', ['额济纳胡杨林', '额济纳']],
    ['呼伦贝尔大草原·莫尔格勒河景区', '呼伦贝尔', ['莫尔格勒河', '呼伦贝尔大草原']],
  ],
  '210000': [
    ['沈阳植物园', '沈阳', ['沈阳世博园']],
    ['大连老虎滩海洋公园', '大连', ['老虎滩', '老虎滩海洋公园']],
    ['大连金石滩景区', '大连', ['金石滩']],
    ['本溪水洞景区', '本溪', ['本溪水洞']],
    ['鞍山千山景区', '鞍山', ['千山']],
    ['盘锦红海滩风景廊道景区', '盘锦', ['红海滩']],
    ['本溪五女山景区', '本溪', ['五女山']],
  ],
  '220000': [
    ['伪满皇宫博物院', '长春', ['伪满皇宫']],
    ['长白山景区', '延边', ['长白山', '长白山天池']],
    ['长春净月潭景区', '长春', ['净月潭']],
    ['长影世纪城旅游区', '长春', ['长影世纪城']],
    ['长春世界雕塑园', '长春', ['长春雕塑园']],
    ['六鼎山文化旅游区', '延边', ['六鼎山', '敦化六鼎山']],
    ['高句丽文物古迹旅游景区', '通化', ['集安高句丽', '好太王碑']],
    ['松原查干湖景区', '松原', ['查干湖']],
  ],
  '230000': [
    ['哈尔滨太阳岛景区', '哈尔滨', ['太阳岛']],
    ['五大连池景区', '黑河', ['五大连池']],
    ['镜泊湖景区', '牡丹江', ['镜泊湖']],
    ['汤旺河林海奇石景区', '伊春', ['汤旺河']],
    ['漠河北极村旅游区', '大兴安岭', ['北极村', '漠河北极村']],
    ['虎头旅游景区', '鸡西', ['虎头要塞']],
  ],
  '310000': [
    ['东方明珠广播电视塔', '上海', ['东方明珠']],
    ['上海野生动物园', '上海'],
    ['上海科技馆', '上海'],
    ['中国共产党一大·二大·四大纪念馆景区', '上海', ['中共一大会址', '一大会址']],
    ['西沙明珠湖景区', '上海', ['明珠湖', '西沙湿地']],
  ],
  '320000': [
    ['中山陵园风景区', '南京', ['中山陵', '明孝陵', '紫金山']],
    ['夫子庙—秦淮风光带', '南京', ['夫子庙', '秦淮河']],
    ['苏州园林（拙政园、虎丘、留园）', '苏州', ['拙政园', '虎丘', '留园']],
    ['周庄古镇景区', '苏州', ['周庄', '周庄古镇']],
    ['同里古镇景区', '苏州', ['同里', '同里古镇']],
    ['金鸡湖景区', '苏州', ['金鸡湖']],
    ['苏州吴中太湖旅游区', '苏州', ['太湖', '穹窿山']],
    ['沙家浜·虞山尚湖旅游区', '苏州', ['沙家浜', '尚湖']],
    ['灵山景区', '无锡', ['灵山大佛', '灵山胜境']],
    ['太湖鼋头渚风景区', '无锡', ['鼋头渚']],
    ['三国水浒景区', '无锡', ['三国城', '水浒城']],
    ['惠山古镇景区', '无锡', ['惠山古镇']],
    ['瘦西湖风景区', '扬州', ['瘦西湖']],
    ['环球恐龙城休闲旅游区', '常州', ['中华恐龙园', '常州恐龙园']],
    ['天目湖景区', '常州', ['天目湖']],
    ['春秋淹城旅游区', '常州', ['淹城']],
    ['金山·焦山·北固山旅游景区', '镇江', ['金山寺', '北固山', '焦山']],
    ['句容茅山景区', '镇江', ['茅山']],
    ['濠河风景区', '南通', ['濠河']],
    ['花果山景区', '连云港', ['花果山']],
    ['云龙湖景区', '徐州', ['云龙湖']],
    ['大丰中华麋鹿园', '盐城', ['中华麋鹿园']],
    ['溱湖旅游景区', '泰州', ['溱湖']],
    ['周恩来故里旅游景区', '淮安', ['周恩来故居']],
    ['洪泽湖湿地景区', '宿迁', ['洪泽湖']],
  ],
  '330000': [
    ['杭州西湖风景名胜区', '杭州', ['西湖', '断桥', '雷峰塔']],
    ['千岛湖风景区', '杭州', ['千岛湖']],
    ['西溪湿地旅游区', '杭州', ['西溪湿地']],
    ['普陀山风景名胜区', '舟山', ['普陀山']],
    ['乌镇古镇旅游区', '嘉兴', ['乌镇']],
    ['西塘古镇旅游景区', '嘉兴', ['西塘', '西塘古镇']],
    ['南湖旅游区', '嘉兴', ['嘉兴南湖']],
    ['雁荡山风景名胜区', '温州', ['雁荡山']],
    ['刘伯温故里景区', '温州', ['百丈漈', '刘伯温故里']],
    ['横店影视城景区', '金华', ['横店影视城', '横店']],
    ['溪口—滕头旅游景区', '宁波', ['溪口', '雪窦山']],
    ['天一阁·月湖景区', '宁波', ['天一阁']],
    ['鲁迅故里·沈园景区', '绍兴', ['鲁迅故里', '沈园']],
    ['天台山景区', '台州', ['天台山', '国清寺']],
    ['神仙居景区', '台州', ['神仙居']],
    ['台州府城文化旅游区', '台州', ['临海古城', '紫阳街', '江南长城']],
    ['南浔古镇景区', '湖州', ['南浔', '南浔古镇']],
    ['根宫佛国文化旅游区', '衢州', ['根宫佛国']],
    ['江郎山·廿八都景区', '衢州', ['江郎山', '廿八都']],
    ['缙云仙都景区', '丽水', ['仙都', '缙云仙都']],
    ['云和梯田景区', '丽水', ['云和梯田']],
  ],
  '340000': [
    ['黄山风景区', '黄山', ['黄山']],
    ['皖南古村落—西递宏村', '黄山', ['西递', '宏村']],
    ['古徽州文化旅游区', '黄山', ['徽州古城', '呈坎', '棠樾牌坊群']],
    ['九华山风景区', '池州', ['九华山']],
    ['天柱山风景区', '安庆', ['天柱山']],
    ['天堂寨旅游景区', '六安', ['天堂寨']],
    ['万佛湖景区', '六安', ['万佛湖']],
    ['龙川景区', '宣城', ['绩溪龙川']],
    ['三河古镇景区', '合肥', ['三河古镇']],
    ['方特旅游区', '芜湖', ['芜湖方特']],
    ['八里河旅游区', '阜阳', ['八里河']],
    ['采石矶景区', '马鞍山', ['采石矶']],
    ['琅琊山景区', '滁州', ['琅琊山', '醉翁亭']],
  ],
  '350000': [
    ['鼓浪屿风景名胜区', '厦门', ['鼓浪屿']],
    ['武夷山风景名胜区', '南平', ['武夷山']],
    ['福建土楼（永定·南靖）旅游景区', '龙岩', ['福建土楼', '永定土楼', '南靖土楼', '云水谣']],
    ['三坊七巷景区', '福州', ['三坊七巷']],
    ['清源山景区', '泉州', ['清源山']],
    ['太姥山旅游区', '宁德', ['太姥山']],
    ['白水洋·鸳鸯溪旅游区', '宁德', ['白水洋', '鸳鸯溪']],
    ['泰宁风景旅游区', '三明', ['泰宁', '大金湖']],
    ['古田旅游区', '龙岩', ['古田会议会址']],
    ['湄洲岛妈祖文化旅游区', '莆田', ['湄洲岛']],
    ['冠豸山景区', '龙岩', ['冠豸山']],
  ],
  '360000': [
    ['庐山风景名胜区', '九江', ['庐山']],
    ['庐山西海风景名胜区', '九江', ['庐山西海']],
    ['井冈山风景旅游区', '吉安', ['井冈山']],
    ['三清山旅游景区', '上饶', ['三清山']],
    ['婺源江湾景区', '上饶', ['婺源', '江湾']],
    ['龟峰景区', '上饶', ['龟峰']],
    ['龙虎山旅游景区', '鹰潭', ['龙虎山']],
    ['滕王阁旅游区', '南昌', ['滕王阁']],
    ['景德镇古窑民俗博览区', '景德镇', ['景德镇古窑']],
    ['明月山旅游区', '宜春', ['明月山']],
    ['武功山景区', '萍乡', ['武功山']],
    ['共和国摇篮旅游区', '赣州', ['瑞金']],
    ['三百山景区', '赣州', ['三百山']],
    ['大觉山景区', '抚州', ['大觉山']],
  ],
  '370000': [
    ['泰山景区', '泰安', ['泰山']],
    ['崂山景区', '青岛', ['崂山']],
    ['青岛奥帆海洋文化旅游区', '青岛', ['奥帆中心', '青岛海底世界']],
    ['蓬莱阁旅游区', '烟台', ['蓬莱阁', '三仙山', '八仙过海']],
    ['龙口南山景区', '烟台', ['南山大佛']],
    ['曲阜明故城（三孔）旅游区', '济宁', ['三孔', '孔庙', '孔府', '孔林']],
    ['天下第一泉景区', '济南', ['趵突泉', '大明湖', '五龙潭']],
    ['台儿庄古城景区', '枣庄', ['台儿庄古城', '台儿庄']],
    ['刘公岛景区', '威海', ['刘公岛']],
    ['华夏城旅游景区', '威海', ['威海华夏城']],
    ['青州古城旅游区', '潍坊', ['青州古城']],
    ['沂蒙山旅游区', '临沂', ['沂蒙山', '蒙山']],
    ['萤火虫水洞·地下大峡谷旅游区', '临沂', ['地下大峡谷']],
    ['黄河口生态旅游区', '东营', ['黄河入海口', '黄河口']],
    ['周村古商城景区', '淄博', ['周村古商城']],
  ],
  '410000': [
    ['嵩山少林景区', '郑州', ['少林寺', '嵩山']],
    ['龙门石窟', '洛阳'],
    ['白云山景区', '洛阳', ['洛阳白云山']],
    ['老君山—鸡冠洞旅游区', '洛阳', ['老君山', '鸡冠洞']],
    ['龙潭大峡谷景区', '洛阳', ['龙潭大峡谷']],
    ['清明上河园', '开封'],
    ['云台山风景名胜区', '焦作', ['云台山']],
    ['殷墟景区', '安阳', ['殷墟']],
    ['红旗渠·太行大峡谷旅游景区', '安阳', ['红旗渠', '太行大峡谷']],
    ['尧山—中原大佛景区', '平顶山', ['尧山', '中原大佛']],
    ['老界岭·恐龙遗迹园旅游区', '南阳', ['老界岭']],
    ['嵖岈山旅游景区', '驻马店', ['嵖岈山']],
    ['芒砀山旅游区', '商丘', ['芒砀山']],
    ['八里沟景区', '新乡', ['八里沟']],
    ['鸡公山景区', '信阳', ['鸡公山']],
    ['宝天曼旅游区', '南阳', ['宝天曼']],
  ],
  '420000': [
    ['黄鹤楼公园', '武汉', ['黄鹤楼']],
    ['武汉东湖生态旅游风景区', '武汉', ['东湖', '武汉东湖']],
    ['黄陂木兰文化生态旅游区', '武汉', ['木兰草原', '木兰天池']],
    ['武当山风景区', '十堰', ['武当山']],
    ['神农架旅游区', '神农架', ['神农架']],
    ['三峡大坝—屈原故里旅游区', '宜昌', ['三峡大坝', '屈原故里']],
    ['三峡人家风景区', '宜昌', ['三峡人家']],
    ['清江画廊旅游度假区', '宜昌', ['清江画廊']],
    ['恩施大峡谷景区', '恩施', ['恩施大峡谷']],
    ['神农溪纤夫文化旅游区', '恩施', ['神农溪']],
    ['腾龙洞景区', '恩施', ['腾龙洞']],
    ['古隆中景区', '襄阳', ['古隆中']],
    ['三国赤壁古战场景区', '咸宁', ['赤壁古战场']],
    ['明显陵文化旅游景区', '荆门', ['明显陵']],
    ['荆州古城历史文化旅游区', '荆州', ['荆州古城']],
  ],
  '430000': [
    ['岳麓山—橘子洲旅游区', '长沙', ['岳麓山', '橘子洲', '橘子洲头']],
    ['花明楼景区', '长沙', ['花明楼']],
    ['武陵源—天门山旅游区', '张家界', ['张家界', '武陵源', '天门山', '张家界国家森林公园']],
    ['南岳衡山旅游区', '衡阳', ['衡山', '南岳衡山']],
    ['韶山旅游区', '湘潭', ['韶山']],
    ['岳阳楼—君山岛景区', '岳阳', ['岳阳楼', '君山岛']],
    ['东江湖旅游区', '郴州', ['东江湖', '雾漫小东江']],
    ['崀山旅游区', '邵阳', ['崀山']],
    ['矮寨·十八洞·德夯大峡谷景区', '湘西', ['矮寨大桥', '德夯']],
    ['凤凰古城旅游区', '湘西', ['凤凰古城']],
    ['桃花源旅游区', '常德', ['常德桃花源']],
    ['炎帝陵景区', '株洲', ['炎帝陵']],
  ],
  '440000': [
    ['广州长隆旅游度假区', '广州', ['长隆', '广州长隆']],
    ['白云山风景区', '广州', ['广州白云山']],
    ['深圳华侨城旅游度假区', '深圳', ['世界之窗', '锦绣中华', '欢乐谷']],
    ['观澜湖休闲旅游区', '深圳', ['观澜湖']],
    ['丹霞山景区', '韶关', ['丹霞山']],
    ['西樵山景区', '佛山', ['西樵山']],
    ['长鹿旅游休博园', '佛山', ['长鹿农庄']],
    ['罗浮山景区', '惠州', ['罗浮山']],
    ['惠州西湖旅游景区', '惠州', ['惠州西湖']],
    ['连州地下河旅游景区', '清远', ['连州地下河']],
    ['星湖旅游景区', '肇庆', ['七星岩', '鼎湖山']],
    ['开平碉楼文化旅游区', '江门', ['开平碉楼']],
    ['雁南飞茶田景区', '梅州', ['雁南飞']],
    ['海陵岛大角湾海上丝路旅游区', '阳江', ['海陵岛']],
    ['湖光岩风景区', '湛江', ['湖光岩']],
    ['万绿湖风景区', '河源', ['万绿湖']],
  ],
  '450000': [
    ['桂林漓江景区', '桂林', ['漓江', '阳朔漓江']],
    ['桂林两江四湖·象山景区', '桂林', ['象鼻山', '两江四湖']],
    ['独秀峰—王城景区', '桂林', ['靖江王城', '独秀峰']],
    ['青秀山旅游区', '南宁', ['青秀山']],
    ['德天跨国瀑布景区', '崇左', ['德天瀑布', '德天跨国瀑布']],
    ['花山岩画景区', '崇左', ['花山岩画']],
    ['涠洲岛南湾鳄鱼山景区', '北海', ['涠洲岛', '鳄鱼山']],
    ['黄姚古镇景区', '贺州', ['黄姚古镇']],
    ['程阳八寨景区', '柳州', ['程阳八寨']],
    ['百色起义纪念园景区', '百色', ['百色起义纪念馆']],
  ],
  '460000': [
    ['三亚南山文化旅游区', '三亚', ['南山寺', '海上观音', '三亚南山']],
    ['三亚大小洞天旅游区', '三亚', ['大小洞天']],
    ['蜈支洲岛旅游区', '三亚', ['蜈支洲岛']],
    ['天涯海角游览区', '三亚', ['天涯海角']],
    ['呀诺达雨林文化旅游区', '保亭', ['呀诺达']],
    ['槟榔谷黎苗文化旅游区', '保亭', ['槟榔谷']],
    ['分界洲岛旅游区', '陵水', ['分界洲岛']],
  ],
  '500000': [
    ['大足石刻景区', '重庆', ['大足石刻']],
    ['武隆喀斯特旅游区', '重庆', ['武隆', '天生三桥', '仙女山']],
    ['巫山小三峡—小小三峡', '重庆', ['小三峡']],
    ['白帝城·瞿塘峡景区', '重庆', ['白帝城', '瞿塘峡']],
    ['南川金佛山景区', '重庆', ['金佛山']],
    ['酉阳桃花源景区', '重庆', ['酉阳桃花源']],
    ['黑山谷景区', '重庆', ['黑山谷']],
    ['江津四面山景区', '重庆', ['四面山']],
    ['云阳龙缸景区', '重庆', ['龙缸']],
    ['阿依河景区', '重庆', ['阿依河']],
    ['濯水景区', '重庆', ['濯水古镇']],
    ['涪陵武陵山大裂谷景区', '重庆', ['武陵山大裂谷']],
  ],
  '510000': [
    ['青城山—都江堰旅游景区', '成都', ['都江堰', '青城山']],
    ['安仁古镇景区', '成都', ['安仁古镇']],
    ['天台山景区（成都）', '成都', ['邛崃天台山']],
    ['九寨沟旅游景区', '阿坝', ['九寨沟']],
    ['黄龙风景名胜区', '阿坝', ['黄龙']],
    ['汶川特别旅游区', '阿坝', ['水磨古镇', '映秀']],
    ['四姑娘山景区', '阿坝', ['四姑娘山']],
    ['峨眉山景区', '乐山', ['峨眉山']],
    ['乐山大佛景区', '乐山', ['乐山大佛']],
    ['稻城亚丁旅游景区', '甘孜', ['稻城亚丁', '亚丁']],
    ['海螺沟景区', '甘孜', ['海螺沟']],
    ['阆中古城旅游区', '南充', ['阆中古城']],
    ['朱德故里景区', '南充', ['朱德故里']],
    ['邓小平故里旅游区', '广安', ['邓小平故里']],
    ['剑门蜀道剑门关旅游区', '广元', ['剑门关']],
    ['碧峰峡旅游景区', '雅安', ['碧峰峡']],
    ['光雾山旅游景区', '巴中', ['光雾山']],
  ],
  '520000': [
    ['黄果树大瀑布景区', '安顺', ['黄果树', '黄果树瀑布']],
    ['龙宫景区', '安顺', ['安顺龙宫']],
    ['百里杜鹃景区', '毕节', ['百里杜鹃']],
    ['织金洞景区', '毕节', ['织金洞']],
    ['荔波樟江景区', '黔南', ['荔波小七孔', '小七孔', '大小七孔']],
    ['青岩古镇景区', '贵阳', ['青岩古镇']],
    ['梵净山旅游区', '铜仁', ['梵净山']],
    ['镇远古城旅游景区', '黔东南', ['镇远古城']],
    ['赤水丹霞旅游区', '遵义', ['赤水丹霞', '赤水大瀑布']],
  ],
  '530000': [
    ['石林风景区', '昆明', ['昆明石林', '石林']],
    ['昆明世博园景区', '昆明', ['昆明世博园']],
    ['丽江古城景区', '丽江', ['丽江古城', '大研古城', '束河古镇']],
    ['玉龙雪山景区', '丽江', ['玉龙雪山', '蓝月谷']],
    ['崇圣寺三塔文化旅游区', '大理', ['崇圣寺三塔', '大理三塔']],
    ['西双版纳热带植物园', '西双版纳', ['中科院热带植物园', '版纳植物园']],
    ['普达措景区', '迪庆', ['普达措', '普达措国家公园']],
    ['虎跳峡景区', '迪庆', ['虎跳峡']],
    ['火山热海旅游区', '保山', ['腾冲热海', '热海']],
    ['和顺古镇景区', '保山', ['和顺古镇']],
  ],
  '540000': [
    ['布达拉宫景区', '拉萨', ['布达拉宫']],
    ['大昭寺', '拉萨', ['大昭寺', '八廓街']],
    ['巴松措景区', '林芝', ['巴松措']],
    ['雅鲁藏布大峡谷旅游景区', '林芝', ['雅鲁藏布大峡谷']],
    ['扎什伦布寺景区', '日喀则', ['扎什伦布寺']],
  ],
  '610000': [
    ['秦始皇帝陵博物院', '西安', ['兵马俑', '秦始皇兵马俑']],
    ['华清宫景区', '西安', ['华清宫', '华清池']],
    ['大雁塔·大唐芙蓉园景区', '西安', ['大雁塔', '大唐芙蓉园', '大唐不夜城']],
    ['西安城墙·碑林历史文化景区', '西安', ['西安城墙', '碑林博物馆']],
    ['华山景区', '渭南', ['华山']],
    ['法门文化景区', '宝鸡', ['法门寺']],
    ['太白山旅游景区', '宝鸡', ['太白山']],
    ['黄帝陵景区', '延安', ['黄帝陵']],
    ['延安革命纪念地景区', '延安', ['宝塔山', '杨家岭', '枣园']],
    ['黄河壶口瀑布旅游区（陕西）', '延安', ['陕西壶口瀑布']],
    ['金丝峡景区', '商洛', ['金丝峡']],
    ['大明宫旅游景区', '西安', ['大明宫']],
    ['乾坤湾景区', '延安', ['乾坤湾']],
  ],
  '620000': [
    ['鸣沙山月牙泉景区', '酒泉', ['鸣沙山', '月牙泉']],
    ['嘉峪关文物景区', '嘉峪关', ['嘉峪关', '嘉峪关关城']],
    ['麦积山景区', '天水', ['麦积山', '麦积山石窟']],
    ['崆峒山风景名胜区', '平凉', ['崆峒山']],
    ['张掖七彩丹霞旅游景区', '张掖', ['七彩丹霞', '张掖丹霞']],
    ['炳灵寺世界文化遗产旅游区', '临夏', ['炳灵寺']],
    ['官鹅沟大景区', '陇南', ['官鹅沟']],
  ],
  '630000': [
    ['青海湖景区', '海南州', ['青海湖', '二郎剑']],
    ['塔尔寺景区', '西宁', ['塔尔寺']],
    ['互助土族故土园景区', '海东', ['互助土族风情园']],
    ['阿咪东索景区', '海北州', ['卓尔山', '阿咪东索']],
  ],
  '640000': [
    ['沙坡头旅游景区', '中卫', ['沙坡头']],
    ['沙湖旅游景区', '石嘴山', ['沙湖']],
    ['镇北堡西部影城', '银川', ['镇北堡', '西部影城']],
    ['水洞沟旅游区', '银川', ['水洞沟']],
    ['青铜峡黄河大峡谷旅游区', '吴忠', ['青铜峡']],
  ],
  '650000': [
    ['天山天池风景名胜区', '昌吉', ['天山天池']],
    ['葡萄沟风景区', '吐鲁番', ['葡萄沟']],
    ['喀纳斯景区', '阿勒泰', ['喀纳斯', '禾木']],
    ['可可托海景区', '阿勒泰', ['可可托海']],
    ['那拉提旅游风景区', '伊犁', ['那拉提', '那拉提草原']],
    ['喀拉峻景区', '伊犁', ['喀拉峻']],
    ['赛里木湖景区', '博尔塔拉', ['赛里木湖']],
    ['巴音布鲁克景区', '巴音郭楞', ['巴音布鲁克']],
    ['博斯腾湖景区', '巴音郭楞', ['博斯腾湖']],
    ['喀什古城景区', '喀什', ['喀什古城', '喀什老城']],
    ['帕米尔旅游区', '喀什', ['帕米尔高原', '白沙湖', '塔县']],
    ['泽普金湖杨景区', '喀什', ['金湖杨']],
    ['天山大峡谷景区', '乌鲁木齐', ['乌鲁木齐天山大峡谷']],
    ['江布拉克景区', '昌吉', ['江布拉克']],
    ['世界魔鬼城景区', '克拉玛依', ['乌尔禾魔鬼城', '魔鬼城']],
    ['天山托木尔景区', '阿克苏', ['托木尔大峡谷']],
    ['白沙湖景区', '阿勒泰', ['哈巴河白沙湖']],
  ],
};

type RawHeritageTuple = [
  name: string,
  provinceCode: string,
  category: 'heritage-cultural' | 'heritage-natural' | 'heritage-mixed',
  city?: string,
  aliases?: string[],
];

/** 中国世界遗产名录（文化遗产 / 自然遗产 / 文化与自然双遗产）。 */
const RAW_HERITAGE_LIST: RawHeritageTuple[] = [
  // 世界文化遗产
  ['长城', '110000', 'heritage-cultural', '北京', ['八达岭长城', '慕田峪长城', '金山岭长城', '山海关', '嘉峪关']],
  ['北京及沈阳的明清皇家宫殿', '110000', 'heritage-cultural', '北京', ['故宫', '故宫博物院', '沈阳故宫']],
  ['周口店北京人遗址', '110000', 'heritage-cultural', '北京', ['周口店']],
  ['颐和园', '110000', 'heritage-cultural', '北京'],
  ['天坛', '110000', 'heritage-cultural', '北京', ['天坛公园']],
  ['明清皇家陵寝', '110000', 'heritage-cultural', '北京', ['明十三陵', '清东陵', '清西陵', '明孝陵', '明显陵']],
  ['北京中轴线', '110000', 'heritage-cultural', '北京', ['景山', '钟鼓楼', '前门', '天安门']],
  ['承德避暑山庄及周围寺庙', '130000', 'heritage-cultural', '承德', ['避暑山庄', '外八庙']],
  ['平遥古城', '140000', 'heritage-cultural', '晋中'],
  ['云冈石窟', '140000', 'heritage-cultural', '大同'],
  ['五台山', '140000', 'heritage-cultural', '忻州'],
  ['元上都遗址', '150000', 'heritage-cultural', '锡林郭勒', ['元上都']],
  ['高句丽王城、王陵及贵族墓葬', '220000', 'heritage-cultural', '通化', ['高句丽', '集安高句丽', '五女山']],
  ['苏州古典园林', '320000', 'heritage-cultural', '苏州', ['拙政园', '留园', '网师园', '狮子林', '沧浪亭']],
  ['中国大运河', '320000', 'heritage-cultural', '扬州', ['京杭大运河', '大运河']],
  ['杭州西湖文化景观', '330000', 'heritage-cultural', '杭州', ['西湖']],
  ['良渚古城遗址', '330000', 'heritage-cultural', '杭州', ['良渚', '良渚博物院']],
  ['皖南古村落—西递、宏村', '340000', 'heritage-cultural', '黄山', ['西递', '宏村']],
  ['福建土楼', '350000', 'heritage-cultural', '龙岩', ['永定土楼', '南靖土楼']],
  ['鼓浪屿：历史国际社区', '350000', 'heritage-cultural', '厦门', ['鼓浪屿']],
  ['泉州：宋元中国的世界海洋商贸中心', '350000', 'heritage-cultural', '泉州', ['开元寺', '清净寺', '洛阳桥', '泉州古城']],
  ['庐山国家公园', '360000', 'heritage-cultural', '九江', ['庐山']],
  ['曲阜孔庙、孔林和孔府', '370000', 'heritage-cultural', '济宁', ['三孔', '孔庙', '孔府', '孔林']],
  ['龙门石窟', '410000', 'heritage-cultural', '洛阳'],
  ['殷墟', '410000', 'heritage-cultural', '安阳'],
  ['登封“天地之中”历史建筑群', '410000', 'heritage-cultural', '郑州', ['少林寺', '嵩阳书院', '中岳庙']],
  ['武当山古建筑群', '420000', 'heritage-cultural', '十堰', ['武当山']],
  ['土司遗址', '430000', 'heritage-cultural', '湘西', ['老司城', '唐崖土司', '海龙屯']],
  ['开平碉楼与村落', '440000', 'heritage-cultural', '江门', ['开平碉楼']],
  ['左江花山岩画文化景观', '450000', 'heritage-cultural', '崇左', ['花山岩画']],
  ['大足石刻', '500000', 'heritage-cultural', '重庆'],
  ['青城山与都江堰', '510000', 'heritage-cultural', '成都', ['都江堰', '青城山']],
  ['丽江古城', '530000', 'heritage-cultural', '丽江', ['大研古城', '束河古镇']],
  ['红河哈尼梯田文化景观', '530000', 'heritage-cultural', '红河', ['元阳梯田', '哈尼梯田']],
  ['普洱景迈山古茶林文化景观', '530000', 'heritage-cultural', '普洱', ['景迈山']],
  ['拉萨布达拉宫历史建筑群', '540000', 'heritage-cultural', '拉萨', ['布达拉宫', '大昭寺', '罗布林卡']],
  ['秦始皇陵及兵马俑坑', '610000', 'heritage-cultural', '西安', ['兵马俑', '秦始皇帝陵']],
  ['丝绸之路：长安—天山廊道的路网', '610000', 'heritage-cultural', '西安', ['大雁塔', '小雁塔', '大明宫', '麦积山', '交河故城']],
  ['莫高窟', '620000', 'heritage-cultural', '酒泉', ['敦煌莫高窟']],
  ['澳门历史城区', '820000', 'heritage-cultural', '澳门', ['大三巴', '议事亭前地', '妈阁庙']],

  // 世界自然遗产
  ['中国黄（渤）海候鸟栖息地', '320000', 'heritage-natural', '盐城', ['盐城湿地', '丹顶鹤湿地']],
  ['中国丹霞', '350000', 'heritage-natural', '韶关', ['丹霞山', '泰宁丹霞', '龙虎山', '江郎山', '崀山', '赤水丹霞']],
  ['三清山国家公园', '360000', 'heritage-natural', '上饶', ['三清山']],
  ['湖北神农架', '420000', 'heritage-natural', '神农架', ['神农架']],
  ['武陵源风景名胜区', '430000', 'heritage-natural', '张家界', ['张家界', '武陵源']],
  ['中国南方喀斯特', '450000', 'heritage-natural', '桂林', ['桂林山水', '石林', '荔波小七孔', '武隆喀斯特']],
  ['九寨沟风景名胜区', '510000', 'heritage-natural', '阿坝', ['九寨沟']],
  ['黄龙风景名胜区', '510000', 'heritage-natural', '阿坝', ['黄龙']],
  ['四川大熊猫栖息地', '510000', 'heritage-natural', '雅安', ['卧龙', '四姑娘山', '碧峰峡']],
  ['梵净山', '520000', 'heritage-natural', '铜仁'],
  ['云南三江并流保护区', '530000', 'heritage-natural', '迪庆', ['三江并流', '梅里雪山', '虎跳峡', '怒江']],
  ['澄江化石地', '530000', 'heritage-natural', '玉溪', ['澄江化石']],
  ['青海可可西里', '630000', 'heritage-natural', '玉树', ['可可西里']],
  ['新疆天山', '650000', 'heritage-natural', '昌吉', ['天山天池', '喀拉峻', '巴音布鲁克', '托木尔']],
  ['巴丹吉林沙漠—沙山湖泊群', '150000', 'heritage-natural', '阿拉善盟', ['巴丹吉林沙漠']],

  // 世界文化与自然双遗产
  ['泰山', '370000', 'heritage-mixed', '泰安', ['泰山景区']],
  ['黄山', '340000', 'heritage-mixed', '黄山', ['黄山风景区']],
  ['峨眉山—乐山大佛', '510000', 'heritage-mixed', '乐山', ['峨眉山', '乐山大佛']],
  ['武夷山', '350000', 'heritage-mixed', '南平', ['武夷山风景名胜区']],
];

function buildScenicCatalog(): ScenicSpot[] {
  const spots: ScenicSpot[] = [];
  for (const [provinceCode, tuples] of Object.entries(RAW_5A_BY_PROVINCE)) {
    const provinceName = PROVINCE_NAMES[provinceCode] ?? provinceCode;
    tuples.forEach(([name, city, aliases], idx) => {
      spots.push({
        id: `5a:${provinceCode}:${idx + 1}`,
        name,
        provinceCode,
        provinceName,
        city,
        category: '5a',
        aliases,
      });
    });
  }
  RAW_HERITAGE_LIST.forEach(([name, provinceCode, category, city, aliases], idx) => {
    spots.push({
      id: `wh:${idx + 1}`,
      name,
      provinceCode,
      provinceName: PROVINCE_NAMES[provinceCode] ?? provinceCode,
      city,
      category,
      aliases,
    });
  });
  return spots;
}

export const SCENIC_CATALOG: ScenicSpot[] = buildScenicCatalog();

function normalizeSpotText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s·•\-—–()（）【】\[\]、,，。:：'"“”‘’]/g, '');
}

const SUFFIX_RE = /(风景名胜区|历史文化旅游区|生态文化旅游区|文化旅游景区|文化旅游区|旅游度假区|旅游风景区|旅游景区|风景区|旅游区|景区|国家森林公园|国家公园|博物院|博物馆|遗址|公园)$/g;

function coreSpotTokens(spot: ScenicSpot): string[] {
  const rawList = [spot.name, ...(spot.aliases ?? [])];
  const tokens = new Set<string>();
  for (const raw of rawList) {
    const norm = normalizeSpotText(raw);
    if (norm.length >= 2) tokens.add(norm);
    const stripped = norm.replace(SUFFIX_RE, '');
    if (stripped.length >= 2) tokens.add(stripped);
  }
  return [...tokens];
}

const SPOT_TOKENS = new Map<string, string[]>(
  SCENIC_CATALOG.map((spot) => [spot.id, coreSpotTokens(spot)]),
);

interface VisitedCandidate {
  raw: string;
  norm: string;
  from: 'plan' | 'journal' | 'ticket';
  date?: string;
}

function collectVisitedCandidates(
  aiPlans: AiTravelPlan[],
  places: JourneyPlace[],
  entries: DayEntry[],
  tickets: TravelTicket[],
  now: Date,
): VisitedCandidate[] {
  const candidates: VisitedCandidate[] = [];
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const push = (raw: string | undefined | null, from: VisitedCandidate['from'], date?: string) => {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return;
    const norm = normalizeSpotText(trimmed);
    if (norm.length < 2) return;
    candidates.push({ raw: trimmed, norm, from, date });
  };

  for (const plan of aiPlans) {
    for (const day of plan.content.days) {
      for (const act of day.activities) {
        const visitedByRecord = Boolean(plannerJournalVisitFor(plan, act));
        const visitedByTime = isActivityTimePassed(day.date, act.endTime, now);
        if (!visitedByRecord && !visitedByTime) continue;
        push(act.title, 'plan', day.date);
        if (act.location && act.location !== act.title) push(act.location, 'plan', day.date);
        if (act.photoQuery && act.photoQuery !== act.title) push(act.photoQuery, 'plan', day.date);
      }
    }
  }

  for (const place of places) {
    push(place.name, 'journal', place.createdAt?.slice(0, 10));
  }

  for (const entry of entries) {
    push(entry.place, 'journal', entry.date);
  }

  for (const ticket of tickets) {
    if (ticket.date && ticket.date > today) continue;
    push(ticket.fromPlace, 'ticket', ticket.date);
    push(ticket.toPlace, 'ticket', ticket.date);
    if (ticket.kind === 'ticket') {
      push(ticket.code, 'ticket', ticket.date);
      push(ticket.note, 'ticket', ticket.date);
    }
  }

  return candidates;
}

function matchSpotToCandidates(
  spot: ScenicSpot,
  candidates: VisitedCandidate[],
): VisitedCandidate | null {
  const tokens = SPOT_TOKENS.get(spot.id) ?? [];
  if (!tokens.length) return null;
  for (const cand of candidates) {
    for (const token of tokens) {
      if (token.length < 2) continue;
      // 双向包含：行程里写“游览故宫博物院”包含“故宫博物院”，或写“伪满皇宫”被“伪满皇宫博物院”包含（且至少 2 字）
      if (cand.norm.includes(token)) return cand;
      if (cand.norm.length >= 2 && token.includes(cand.norm)) {
        // 避免极短泛词（如“公园”“古城”“西湖”除外）误匹配
        if (cand.norm.length >= 3 || token === cand.norm) return cand;
      }
    }
  }
  return null;
}

export function resolveScenicProgress(params: {
  aiPlans?: AiTravelPlan[];
  places?: JourneyPlace[];
  entries?: DayEntry[];
  tickets?: TravelTicket[];
  manual?: ScenicManualMap;
  now?: Date;
}): ScenicProgressReport {
  const now = params.now ?? new Date();
  const manual = params.manual ?? readScenicManualMap();
  const tickets = params.tickets ?? loadTicketsFromStorage();
  const candidates = collectVisitedCandidates(
    params.aiPlans ?? [],
    params.places ?? [],
    params.entries ?? [],
    tickets,
    now,
  );

  const items: ScenicVisitInfo[] = [];
  const byId = new Map<string, ScenicVisitInfo>();
  const byProvince = new Map<string, ProvinceScenicSummary>();

  const totals = {
    fiveA: { visited: 0, total: 0 },
    heritageAll: { visited: 0, total: 0 },
    heritageCultural: { visited: 0, total: 0 },
    heritageNatural: { visited: 0, total: 0 },
    heritageMixed: { visited: 0, total: 0 },
  };

  for (const spot of SCENIC_CATALOG) {
    const autoHit = matchSpotToCandidates(spot, candidates);
    const manualRec = manual[spot.id];
    let visited = false;
    let source: 'auto' | 'manual' | null = null;
    if (manualRec) {
      visited = manualRec.visited;
      source = visited ? (autoHit ? 'auto' : 'manual') : null;
    } else if (autoHit) {
      visited = true;
      source = 'auto';
    }

    const info: ScenicVisitInfo = {
      spot,
      visited,
      source,
      matchedFrom: visited && autoHit ? autoHit.from : undefined,
      matchedText: visited && autoHit ? autoHit.raw : undefined,
      date: visited ? (autoHit?.date ?? manualRec?.updatedAt?.slice(0, 10)) : undefined,
    };
    items.push(info);
    byId.set(spot.id, info);

    let prov = byProvince.get(spot.provinceCode);
    if (!prov) {
      prov = {
        provinceCode: spot.provinceCode,
        provinceName: spot.provinceName,
        fiveATotal: 0,
        fiveAVisited: 0,
        heritageTotal: 0,
        heritageVisited: 0,
        heritageCulturalTotal: 0,
        heritageCulturalVisited: 0,
        heritageNaturalTotal: 0,
        heritageNaturalVisited: 0,
        heritageMixedTotal: 0,
        heritageMixedVisited: 0,
        spots: [],
        autoMatchedSpots: [],
      };
      byProvince.set(spot.provinceCode, prov);
    }
    prov.spots.push(info);
    if (info.visited && info.source === 'auto') prov.autoMatchedSpots.push(info);

    if (spot.category === '5a') {
      totals.fiveA.total += 1;
      prov.fiveATotal += 1;
      if (visited) {
        totals.fiveA.visited += 1;
        prov.fiveAVisited += 1;
      }
    } else {
      totals.heritageAll.total += 1;
      prov.heritageTotal += 1;
      if (visited) {
        totals.heritageAll.visited += 1;
        prov.heritageVisited += 1;
      }
      if (spot.category === 'heritage-cultural') {
        totals.heritageCultural.total += 1;
        prov.heritageCulturalTotal += 1;
        if (visited) {
          totals.heritageCultural.visited += 1;
          prov.heritageCulturalVisited += 1;
        }
      } else if (spot.category === 'heritage-natural') {
        totals.heritageNatural.total += 1;
        prov.heritageNaturalTotal += 1;
        if (visited) {
          totals.heritageNatural.visited += 1;
          prov.heritageNaturalVisited += 1;
        }
      } else {
        totals.heritageMixed.total += 1;
        prov.heritageMixedTotal += 1;
        if (visited) {
          totals.heritageMixed.visited += 1;
          prov.heritageMixedVisited += 1;
        }
      }
    }
  }

  const provinces = [...byProvince.values()].sort((a, b) => {
    const aVisited = a.fiveAVisited + a.heritageVisited;
    const bVisited = b.fiveAVisited + b.heritageVisited;
    if (bVisited !== aVisited) return bVisited - aVisited;
    return a.provinceCode.localeCompare(b.provinceCode);
  });

  return { items, byId, byProvince, provinces, totals };
}
