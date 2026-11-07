(function(SK) {
  if (!SK || SK.disabled) return;

  // ── GENERATED:ZH-CHAR-SETS BEGIN(tools/build/generate-zh-char-sets.mjs,勿手改)──
  const SIMPLIFIED_ONLY_CHARS = new Set("㐷㐹㐽㑇㑈㑔㑩㓆㓥㓰㔉㖊㖞㘎㚯㛀㛟㛠㛣㛤㛿㟆㟜㟥㡎㤘㤽㥪㧏㧐㧑㧟㧰㨫㭎㭏㭣㭤㭴㱩㱮㲿㳔㳕㳠㳡㳢㳽㴋㶉㶶㶽㺍㻅㻏㻘䀥䁖䂵䃅䅉䅟䅪䇲䉤䌶䌷䌸䌹䌺䌻䌼䌽䌾䌿䍀䍁䍠䎬䏝䑽䓓䓕䓖䓨䗖䘛䘞䙊䙌䙓䜣䜤䜥䜧䜩䝙䞌䞍䞎䞐䟢䢀䢁䢂䥺䥽䥾䥿䦀䦁䦂䦃䦅䦆䦶䦷䩄䭪䯃䯄䯅䲝䲞䲟䲠䲡䲢䲣䴓䴔䴕䴖䴗䴘䴙䶮万与专业丛东丝丢两严丧个临为丽举么义乌乐乔习乡书买乱争亏亘亚产亩亲亵亸亿仅从仑仓仪们众优会伛伞伟传伡伣伤伥伦伧伪伫体佥侠侣侥侦侧侨侩侪侬侭俣俦俨俩俪俫俭债倾偬偻偾偿傤傥傧储傩儿兑兖兰关兴兹养兽冁内冈册写军农冯冲决况冻净凄凉减凑凛凤凫凭凯击凿刍刘则刚创删别刬刭刹刽刾刿剀剂剐剑剥剧劝办务劢动励劲劳势勋勚匀匦匮区医华协单卖卢卤卧卫却卺厂厅历厉压厌厍厐厕厢厣厦厨厩厮县叁参叆叇双发变叙叠号叹叽吓吕吗吨听启吴呐呒呓呕呖呗员呙呛呜咏咙咛咝咤响哑哒哓哔哕哗哙哜哝哟唛唝唠唡唢唤啧啬啭啮啯啰啴啸喷喽喾嗫嗳嘘嘤嘱噜嚣团园囱围囵国图圆圣圹场坏块坚坛坜坝坞坟坠垄垅垆垒垦垩垫垭垯垱垲垴埘埙埚堑堕塆墙壮声壳壶壸处备复够头夹夺奁奂奋奖奥妆妇妈妩妪妫姗姹娄娅娆娇娈娱娲娴婳婴婵婶媪媭嫒嫔嫱嬷孙学孪宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尝尧尴尽层屃屉届属屡屦屿岁岂岖岗岘岚岛岭岽岿峃峄峡峣峤峥峦崂崃崄崭嵘嵚嵝巅巩巯币帅师帏帐帜带帧帮帱帻帼幂并广庄庆庐庑库应庙庞废庼廪开异弃弑张弥弪弯弹强归当录彟彦彨彻径徕忆忏忧忾怀态怂怃怄怅怆怜总怼怿恋恳恶恸恹恺恻恼恽悦悫悬悭悮悯惊惧惨惩惫惬惭惮惯愠愤愦慑慭懑懒懔戆戋戏戗战戬戯户扑执扩扪扫扬扰抚抛抟抠抡抢护报担拟拢拣拥拦拧拨择挂挚挛挜挝挞挟挠挡挢挣挤挥挦捝捞损捡换捣掳掴掷掸掺掼揽揾揿搀搁搂搄搅携摄摅摆摇摈摊撄撑撵撷撸撺擜擞攒敌敚敛敩数斋斓斩断无旧时旷旸昙昵昼昽显晋晒晓晔晕晖暂暅暧术机杀杂权条来杨杩极构枞枢枣枥枧枨枪枫枭柠柽栀栅标栈栉栊栋栌栎栏树栖样栾桠桡桢档桤桥桦桧桨桩桪梦梼梾梿检棁棂椁椝椟椠椢椤椫椭椮楼榄榅榇榈榉榝槚槛槟槠横樯樱橥橱橹橼檩欢欤欧歼殁殇残殒殓殚殡殴毁毂毕毙毡毵毶氇气氢氩氲汇汉汤汹沄沟没沣沤沥沦沧沨沩沪泞泪泶泷泸泺泻泼泽泾洁洒洼浃浅浆浇浈浉浊测浍济浏浐浑浒浓浔浕涚涛涝涞涟涠涡涢涣涤润涧涨涩渊渌渍渎渐渑渔渖渗温湾湿溁溃溅溆溇滗滚滞滟滠满滢滤滥滦滨滩滪潆潇潋潍潜潴澛澜濑濒灏灭灯灵灾灿炀炉炖炜炝点炼炽烁烂烃烛烟烦烧烨烩烫烬热焕焖焘煴爱爷牍牦牵牺犊状犷犸犹狈狝狞独狭狮狯狰狱狲猃猎猕猡猪猫猬献獭玑玙玚玛玮环现玱玺珐珑珰珲琎琏琐琼瑶瑷瑸璎瓒瓮瓯电画畅畴疖疗疟疠疡疬疭疮疯疱疴痈痉痒痖痨痪痫瘅瘆瘗瘘瘪瘫瘾瘿癞癣癫皑皱皲盏盐监盖盗盘眍眦眬睁睐睑瞆瞒瞩矫矶矾矿砀码砖砗砚砜砺砻砾础硁硕硖硗硙硚硵碍碛碜碱礼祃祎祢祯祷祸禀禄禅离秃秆种积称秽秾稆税稣稳穑穞穷窃窍窎窑窜窝窥窦窭竖竞笃笋笔笕笺笼笾筚筛筜筝筹筼签筿简箓箦箧箨箩箪箫篑篓篮篯篱簖籁籴类籼粜粝粤粪粮糁糇糍紧絷縆纟纠纡红纣纤纥约级纨纩纪纫纬纭纮纯纰纱纲纳纴纵纶纷纸纹纺纻纼纽纾线绀绁绂练组绅细织终绉绊绋绌绍绎经绐绑绒结绔绕绖绗绘给绚绛络绝绞统绠绡绢绣绤绥绦继绨绩绪绫绬续绮绯绰绱绲绳维绵绶绷绸绹绺绻综绽绾绿缀缁缂缃缄缅缆缇缈缉缊缋缌缍缎缏缐缑缒缓缔缕编缗缘缙缚缛缜缝缞缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缱缲缳缴缵罂网罗罚罢罴羁羟羡翘翙翚耢耧耸耻聂聋职聍联聩聪肃肠肤肮肴肾肿胀胁胆胧胨胪胫胶脉脍脏脐脑脓脔脚脱脶脸腊腌腘腭腻腼腽腾膑臜舆舣舰舱舻艰艳艺节芈芗芜芦苁苇苈苋苌苍苎苏茎茏茑茔茕茧荆荙荚荛荜荝荞荟荠荡荣荤荥荦荧荨荩荪荫荬荭荮药莅莱莲莳莴莶获莸莹莺莼萚萝萤营萦萧萨葱蒀蒇蒉蒋蒌蒏蓝蓟蓠蓣蓥蓦蔂蔷蔹蔺蔼蕰蕲蕴薮藓蘖虏虑虚虫虬虮虽虾虿蚀蚁蚂蚃蚕蚝蚬蛊蛎蛏蛮蛰蛱蛲蛳蛴蜕蜗蝇蝈蝉蝎蝼蝾螀螨蟏衅衔补衬衮袄袅袆袜袭袯装裆裈裢裣裤裥褛褴襕见观觃规觅视觇览觉觊觋觌觍觎觏觐觑觞触觯訚詟誉誊讠计订讣认讥讦讧讨让讪讫讬训议讯记讱讲讳讴讵讶讷许讹论讻讼讽设访诀证诂诃评诅识诇诈诉诊诋诌词诎诏诐译诒诓诔试诖诗诘诙诚诛诜话诞诟诠诡询诣诤该详诧诨诩诪诫诬语诮误诰诱诲诳说诵诶请诸诹诺读诼诽课诿谀谁谂调谄谅谆谇谈谉谊谋谌谍谎谏谐谑谒谓谔谕谖谗谘谙谚谛谜谝谞谟谠谡谢谣谤谥谦谧谨谩谪谫谬谭谮谯谰谱谲谳谴谵谶豮贝贞负贠贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贶贷贸费贺贻贼贽贾贿赀赁赂赃资赅赆赇赈赉赊赋赌赍赎赏赐赑赒赓赔赕赖赗赘赙赚赛赜赝赞赟赠赡赢赣赪赵赶趋趱趸跃跄跞践跶跷跸跹跻踌踪踬踯蹑蹒蹰蹿躏躜躯车轧轨轩轪轫转轭轮软轰轱轲轳轴轵轶轷轸轹轺轻轼载轾轿辀辁辂较辄辅辆辇辈辉辊辋辌辍辎辏辐辑辒输辔辕辖辗辘辙辚辞辩辫边辽达迁过迈运还这进远违连迟迩迳迹选逊递逦逻遗遥邓邝邬邮邹邺邻郏郐郑郓郦郧郸酂酝酦酱酽酾酿释鉴銮錾钅钆钇针钉钊钋钌钍钎钏钐钑钒钓钔钕钖钗钘钙钚钛钜钝钞钟钠钡钢钣钤钥钦钧钨钩钪钫钬钭钮钯钰钱钲钳钴钵钶钷钸钹钺钻钼钽钾钿铀铁铂铃铄铅铆铇铈铉铊铋铌铍铎铏铐铑铒铓铔铕铖铗铘铙铚铛铜铝铞铟铠铡铢铣铤铥铦铧铨铩铪铫铬铭铮铯铰铱铲铳铴铵银铷铸铹铺铻铼铽链铿销锁锂锃锄锅锆锇锈锉锊锋锌锍锎锏锐锑锒锓锔锕锖锗锘错锚锛锜锝锞锟锠锡锢锣锤锥锦锧锨锩锪锫锬锭键锯锰锱锲锳锴锵锶锷锸锹锺锻锼锽锾锿镀镁镂镃镄镅镆镇镈镉镊镋镌镍镎镏镐镑镒镓镔镕镖镗镘镙镚镛镜镝镞镟镠镡镢镣镤镥镦镧镨镩镪镫镬镭镮镯镰镱镲镳镴镵镶长门闩闪闫闬闭问闯闰闱闲闳间闵闶闷闸闹闺闻闼闽闾闿阀阁阂阃阄阅阆阇阈阉阊阋阌阍阎阏阐阑阒阓阔阕阖阗阘阙阚阛队阳阴阵阶际陆陇陈陉陕陦陧陨险随隐隶隽难雇雏雠雳雾霁霡霭靓靔静靥鞑鞒鞯鞲韦韧韨韩韪韫韬韵页顶顷顸项顺须顼顽顾顿颀颁颂颃预颅领颇颈颉颊颋颌颍颎颏颐频颒颓颔颕颖颗题颙颚颛颜额颞颟颠颡颢颣颤颥颦颧风飏飐飑飒飓飔飕飖飗飘飙飚飞飨餍饣饤饥饦饧饨饩饪饫饬饭饮饯饰饱饲饳饴饵饶饷饸饹饺饻饼饽饾饿馀馁馂馃馄馅馆馇馈馉馊馋馌馍馎馏馐馑馒馓馔馕马驭驮驯驰驱驲驳驴驵驶驷驸驹驺驻驼驽驾驿骀骁骂骃骄骅骆骇骈骉骊骋验骍骎骏骐骑骒骓骔骕骖骗骘骙骚骛骜骝骞骟骠骡骢骣骤骥骦骧髅髋髌鬓鬶魇魉鱼鱽鱾鱿鲀鲁鲂鲃鲄鲅鲆鲇鲈鲉鲊鲋鲌鲍鲎鲏鲐鲑鲒鲓鲔鲕鲖鲗鲘鲙鲚鲛鲜鲝鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲪鲫鲬鲭鲮鲯鲰鲱鲲鲳鲴鲵鲶鲷鲸鲹鲺鲻鲼鲽鲾鲿鳀鳁鳂鳃鳄鳅鳆鳇鳈鳉鳊鳋鳌鳍鳎鳏鳐鳑鳒鳓鳔鳕鳖鳗鳘鳙鳚鳛鳜鳝鳞鳟鳠鳡鳢鳣鳤鸟鸠鸡鸢鸣鸤鸥鸦鸧鸨鸩鸪鸫鸬鸭鸮鸯鸰鸱鸲鸳鸴鸵鸶鸷鸸鸹鸺鸻鸼鸽鸾鸿鹀鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹍鹎鹏鹐鹑鹒鹓鹔鹕鹖鹗鹘鹙鹚鹛鹜鹝鹞鹟鹠鹡鹢鹣鹤鹥鹦鹧鹨鹩鹪鹫鹬鹭鹮鹯鹰鹱鹲鹳鹴鹾麦麸麹麺黄黉黡黩黪黾鼋鼌鼍鼹齐齑齿龀龁龂龃龄龅龆龇龈龉龊龋龌龙龚龛龟鿎鿏鿒鿔");
  const TRADITIONAL_ONLY_CHARS = new Set("㑯㑳㑶㓨㗲㘚㜄㜏㜢㠏㠣㥮㩜㩳㩵㺏䁪䁻䃮䊷䋙䋚䋹䋻䍦䎱䓣䙡䜀䝼䡵䥇䥑䥕䥱䦛䦟䧢䮄䯀䰾䱷䱽䲁䲘䴉丟並亂亙亞佇佈佔併來侖侶侷俁係俔俠俥俬倀倆倈倉個們倖倫倲偉偑側偵偽傌傑傖傘備傢傭傯傳傴債傷傾僂僅僉僑僕僞僤僥僨僱價儀儁儂億儈儉儎儐儔儕儘償優儲儷儸儺儻儼兇兌兒兗內兩冊冑冪凈凍凜凱別刪剄則剋剎剗剛剝剮剴創剷劃劄劇劉劊劌劍劏劑劚勁動務勛勝勞勢勣勩勱勳勵勸勻匭匯匱區協卹卻卽厙厠厤厭厲厴參叄叢吒吳吶呂咼員唄唸問啓啞啟啢喎喚喪喫喬單喲嗆嗇嗊嗎嗚嗩嗰嗶嘆嘍嘓嘔嘖嘗嘜嘩嘮嘯嘰嘵嘸嘽噁噓噚噝噠噥噦噯噲噴噸噹嚀嚇嚌嚐嚕嚙嚥嚦嚧嚨嚮嚲嚳嚴嚶囀囁囂囅囈囉囌囑囪圇國圍園圓圖團垻埡埨埰執堅堊堖堝堯報場塊塋塏塒塗塚塢塤塵塸塹塿墊墜墠墮墰墳墶墻墾壇壋壎壓壗壘壙壚壜壞壟壠壢壩壪壯壺壼壽夠夢夥夾奐奧奩奪奬奮奼妝姍姦娙娛婁婦婭媧媯媰媼媽嫋嫗嫵嫺嫻嫿嬀嬃嬈嬋嬌嬙嬡嬤嬪嬰嬸孃孋孌孫學孻孿宮寀寢實寧審寫寬寵寶將專尋對導尷屆屍屓屜屢層屨屬岡峯峴島峽崍崑崗崙崢崬嵐嵗嵽嵾嶁嶄嶇嶔嶗嶠嶢嶧嶨嶮嶸嶺嶼嶽巋巒巔巖巘巰巹帥師帳帶幀幃幓幗幘幟幣幫幬幷幹幾庫廁廂廄廈廎廕廚廝廞廟廠廡廢廣廩廬廳弒弔弳張強彄彆彈彌彎彔彙彠彥彫彲彿後徑從徠復徵徹恆恥悅悞悵悶悽惡惱惲惻愛愜愨愴愷愾慄態慍慘慚慟慣慤慪慫慮慳慶慺慼慾憂憊憐憑憒憖憚憤憫憮憲憶懇應懌懍懞懟懣懤懨懲懶懷懸懺懼懾戀戇戔戧戩戰戱戲戶扞拋挩挱挾捨捫捱捲掃掄掆掗掙掛採揀揚換揮揯損搖搗搧搵搶摑摜摟摯摳摶摺摻撈撏撐撓撝撟撣撥撫撲撳撻撾撿擁擄擇擊擋擓擔據擠擡擣擬擯擰擱擲擴擷擺擻擼擽擾攄攆攏攔攖攙攛攜攝攢攣攤攪攬敎敓敗敘敵數斂斃斆斕斬斷於旂旣昇時晉晛晝暈暉暐暘暢暫曄曆曇曉曏曖曠曥曨曬書會朥朧朮東枴柵柺査桱桿梔梘梜條梟梲棄棊棖棗棟棡棧棲棶椏椲楊楓楨業極榘榦榪榮榲榿構槍槓槤槧槨槮槳槶槼樁樂樅樑樓標樞樢樣樧樫樳樸樹樺樿橈橋機橢橫橯檁檉檔檜檟檢檣檮檯檳檸檻櫃櫍櫓櫚櫛櫝櫞櫟櫥櫧櫨櫪櫫櫬櫱櫳櫸櫻欄欅權欏欒欓欖欞欽歎歐歟歡歲歷歸歿殘殞殤殨殫殭殮殯殰殲殺殻殼毀毆毿氂氈氌氣氫氬氳氾汎汙決沒沖況泝洩洶浹浿涇涗涼淒淚淥淨淩淪淵淶淺渙減渢渦測渾湊湋湞湧湯溈準溝溫溮溳溼滄滅滌滎滙滬滯滲滷滸滻滾滿漁漊漍漚漢漣漬漲漵漸漿潁潑潔潕潙潚潛潤潯潰潷潿澀澆澇澐澗澠澤澦澩澫澮澱澾濁濃濄濆濕濘濚濛濜濟濤濧濫濰濱濺濼濾瀂瀅瀆瀇瀉瀋瀏瀕瀘瀝瀟瀠瀦瀧瀨瀰瀲瀾灃灄灑灒灕灘灙灝灡灣灤灧灩災為烏烴無煉煒煙煢煥煩煬煱熅熒熗熰熱熲熾燀燁燈燉燒燖燙燜營燦燬燭燴燶燻燼燾爍爐爛爭爲爺爾牀牆牘牴牽犖犛犢犧狀狹狽猙猶猻獁獃獄獅獎獨獪獫獮獰獱獲獵獷獸獺獻獼玀現琱琺琿瑋瑒瑣瑤瑩瑪瑲璉璊璕璗璡璣璦璫璯環璵璸璽璿瓅瓊瓏瓔瓚瓛甌甕產産畝畢畫異畵當疇疊痙痠痾瘂瘋瘍瘓瘞瘡瘧瘮瘲瘺瘻療癆癇癉癒癘癟癡癢癤癥癧癩癬癭癮癰癱癲發皁皚皰皸皺盃盜盞盡監盤盧盪眞眥眾睍睏睜睞瞘瞜瞞瞶瞼矇矓矚矯硃硜硤硨硯碕碩碭碸確碼碽磑磚磠磣磧磯磽磾礄礎礐礙礦礪礫礬礱祕祿禍禎禕禡禦禪禮禰禱禿秈稅稈稏稜稟種稱穀穇穌積穎穠穡穢穩穫穭窩窪窮窯窵窶窺竄竅竇竈竊竪競筆筍筧筴箇箋箏箚節範築篋篔篠篢篤篩篳篸簀簍簑簞簡簣簫簹簽簾籃籅籌籔籙籛籜籟籠籤籩籪籬籮籲粵糉糝糞糧糰糲糴糶糹糾紀紂紃約紅紆紇紈紉紋納紐紓純紕紖紗紘紙級紛紜紝紞紡紬紮細紱紲紳紵紹紺紼紿絀終絃組絅絆絎結絕絛絝絞絡絢給絨絪絰統絲絳絶絹絺綁綃綄綆綈綉綌綎綏綐綑經綖綜綝綞綠綡綢綣綧綪綫綬維綯綰綱網綳綴綵綸綹綺綻綽綾綿緄緇緊緋緑緒緓緔緗緘緙線緝緞締緡緣緦編緩緬緯緱緲練緶緹緻緼縈縉縊縋縐縑縕縗縛縝縞縟縣縧縫縭縮縯縱縲縳縴縵縶縷縹總績繃繅繆繒織繕繚繞繡繢繩繪繫繭繮繯繰繳繶繸繹繻繼繽繾繿纁纆纇纈纊續纍纏纓纔纕纖纘纜缽罃罈罌罎罰罵罷羅羆羈羋羣羥羨義羶習翫翬翹翽耬耮聖聞聯聰聲聳聵聶職聹聽聾肅脅脈脛脣脩脫脹腎腖腡腦腫腳腸膃膕膚膞膠膢膩膽膾膿臉臍臏臘臚臟臠臢臥臨臺與興舉舊舖舘艙艤艦艫艱艷芻茲荊莊莖莢莧華菴菸萇萊萬萴萵葉葒葤葦葯葷蒍蒐蒓蒔蒕蒞蒼蓀蓆蓋蓮蓯蓴蓽蔄蔔蔘蔞蔣蔥蔦蔭蔯蔿蕁蕆蕎蕒蕓蕕蕘蕢蕩蕪蕭蕷薀薈薊薌薑薔薘薟薦薩薳薴薵薹薺藍藎藝藥藪藭藴藶藹藺蘀蘄蘆蘇蘊蘋蘚蘞蘟蘢蘭蘺蘿虆虉處虛虜號虧虯蛺蛻蜆蝀蝕蝟蝦蝨蝸螄螞螢螮螻螿蟄蟈蟎蟣蟬蟯蟲蟳蟶蟻蠁蠅蠆蠍蠐蠑蠔蠟蠣蠨蠱蠶蠻衆衊術衕衚衛衝袞袷裊裏補裝裡製複褌褘褲褳褸褻襀襇襉襏襖襝襠襤襪襬襯襲襴覈見覎規覓視覘覡覥覦親覬覯覲覷覺覽覿觀觴觶觸訁訂訃計訊訌討訏訐訒訓訕訖託記訛訝訟訢訣訥訩訪設許訴訶診註証詀詁詆詎詐詒詔評詖詗詘詛詝詞詠詡詢詣試詩詪詫詬詭詮詰話該詳詵詷詼詿誄誅誆誇誌認誑誒誕誘誚語誠誡誣誤誥誦誨說説誰課誶誹誼誾調諂諄談諉請諍諏諑諒諓論諗諛諜諝諞諟諡諢諤諦諧諫諭諮諱諲諳諴諶諷諸諺諼諾謀謁謂謄謅謊謎謏謐謔謖謗謙謚講謝謠謡謨謫謬謭謳謹謾譁證譎譏譓譖識譙譚譜譞譟譫譭譯議譴護譸譽譾讀讅變讋讌讎讒讓讕讖讚讜讞谿豈豎豐豔豬豶貍貓貙貝貞貟負財貢貧貨販貪貫責貯貰貲貳貴貶買貸貺費貼貽貿賀賁賂賃賄賅資賈賊賑賒賓賕賙賚賜賞賠賡賢賣賤賦賧質賫賬賭賰賴賵賺賻購賽賾贄贅贇贈贊贋贍贏贐贓贔贖贗贛贜赬趕趙趨趲跡踐踰踴蹌蹕蹟蹠蹣蹤蹺躂躉躊躋躍躎躑躒躓躕躚躡躥躦躪軀車軋軌軍軏軑軒軔軛軝軟軤軫軲軸軹軺軻軼軾較輄輅輇輈載輊輋輒輓輔輕輗輛輜輝輞輟輥輦輩輪輬輮輯輳輶輸輻輼輾輿轀轂轄轅轆轉轍轎轔轟轡轢轤辦辭辮辯農迴逕這連週進遊運過達違遙遜遞遠遡適遲遶遷選遺遼邁還邇邊邏邐郟郵鄆鄉鄒鄔鄖鄧鄩鄭鄰鄲鄳鄴鄶鄺酇酈醃醖醜醞醟醣醫醬醱醲釀釁釃釅釋釐釒釓釔釕釗釘釙針釣釤釦釧釩釴釵釷釹釺釾釿鈀鈁鈃鈄鈅鈇鈈鈉鈍鈎鈐鈑鈒鈔鈕鈞鈡鈣鈥鈦鈧鈮鈰鈳鈴鈷鈸鈹鈺鈽鈾鈿鉀鉅鉆鉈鉉鉊鉋鉍鉑鉕鉗鉚鉛鉝鉞鉢鉤鉥鉦鉧鉬鉭鉮鉳鉶鉷鉸鉺鉻鉿銀銃銅銈銍銑銓銖銘銚銛銜銠銣銥銦銨銩銪銫銬銱銳銶銷銹銻銼鋁鋃鋅鋇鋌鋏鋐鋒鋗鋙鋝鋟鋣鋤鋥鋦鋨鋩鋪鋭鋮鋯鋰鋱鋶鋸鋹鋼錀錁錄錆錇錈錏錐錒錕錘錙錚錛錞錟錠錡錢錤錦錨錩錫錮錯録錳錶錸錼鍀鍁鍃鍅鍆鍇鍈鍊鍋鍍鍔鍘鍚鍛鍠鍤鍥鍩鍬鍭鍰鍵鍶鍺鍼鍾鎂鎄鎇鎊鎌鎓鎔鎖鎘鎚鎛鎝鎡鎢鎣鎦鎧鎩鎪鎬鎭鎮鎰鎲鎳鎵鎶鎸鎿鏃鏇鏈鏌鏍鏏鏐鏑鏗鏘鏜鏝鏞鏟鏡鏢鏤鏨鏰鏵鏷鏹鏺鏻鏽鐃鐄鐇鐋鐍鐏鐐鐒鐓鐔鐘鐙鐝鐠鐥鐦鐧鐨鐩鐫鐮鐯鐲鐳鐵鐶鐸鐺鐽鐿鑄鑊鑌鑑鑒鑔鑕鑞鑠鑣鑥鑪鑭鑰鑱鑲鑷鑹鑼鑽鑾鑿钁钂長門閂閃閆閈閉開閌閎閏閑閒間閔閘閡閣閤閥閨閩閫閬閭閱閲閶閹閻閼閽閾閿闃闆闇闈闉闊闋闌闍闐闑闒闓闔闕闖關闞闠闡闢闤闥陘陝陞陣陰陳陸陽隉隊階隑隕際隤隨險隮隯隱隴隸隻雋雖雙雛雜雞離難雲電霑霢霧霽靂靄靆靈靉靚靜靝靦靨鞏鞝鞦鞽韁韃韆韉韋韌韍韓韙韜韝韞韻響頁頂頃項順頇須頊頌頍頎頏預頑頒頓頔頗領頜頠頡頤頦頫頭頮頰頲頴頵頷頸頹頻頽顆題額顎顏顒顓顔顗願顙顛類顢顥顧顫顬顯顰顱顳顴風颭颮颯颱颳颶颸颺颻颼飀飄飆飈飛飠飢飣飥飩飪飫飭飯飱飲飴飼飽飾飿餃餄餅餈餉養餌餎餏餑餒餓餕餖餗餘餚餛餜餞餡館餬餱餳餵餶餷餸餺餼餾餿饁饃饅饈饉饊饋饌饑饒饗饘饜饞饢馬馭馮馱馳馴馹馼駁駃駉駐駑駒駓駔駕駘駙駛駝駟駡駢駪駭駰駱駸駼駿騁騂騄騅騊騌騍騎騏騑騖騙騞騠騤騧騫騭騮騰騱騵騶騷騸騾驀驁驂驃驄驅驊驌驍驎驏驕驗驚驛驟驢驤驥驦驪驫骯髏髒體髕髖髮鬆鬍鬚鬢鬥鬧鬨鬩鬮鬱鬹魎魘魚魛魟魢魨魯魴魷魺鮀鮁鮃鮆鮈鮊鮋鮍鮎鮐鮑鮒鮓鮚鮜鮝鮞鮟鮠鮡鮣鮦鮪鮫鮭鮮鮳鮶鮸鮺鯀鯁鯇鯉鯊鯒鯔鯕鯖鯗鯛鯝鯡鯢鯤鯧鯨鯪鯫鯰鯴鯷鯻鯽鯿鰁鰂鰃鰆鰈鰉鰊鰌鰍鰏鰐鰒鰓鰛鰜鰟鰠鰣鰤鰥鰧鰨鰩鰭鰮鰱鰲鰳鰵鰶鰷鰹鰺鰻鰼鰾鱀鱂鱅鱇鱈鱉鱒鱔鱖鱗鱘鱚鱝鱟鱠鱣鱤鱧鱨鱭鱯鱲鱷鱸鱺鳥鳧鳩鳬鳲鳳鳴鳶鳾鴆鴇鴉鴒鴕鴛鴝鴞鴟鴣鴦鴨鴯鴰鴴鴷鴻鴿鵁鵂鵃鵏鵐鵑鵒鵓鵜鵝鵟鵠鵡鵪鵬鵮鵯鵰鵲鵷鵾鶄鶇鶉鶊鶓鶖鶘鶚鶠鶡鶥鶩鶪鶬鶯鶱鶲鶴鶹鶺鶻鶼鶿鷀鷁鷂鷄鷉鷊鷓鷖鷗鷙鷚鷟鷥鷦鷫鷭鷯鷲鷳鷴鷸鷹鷺鷽鸂鸇鸊鸌鸏鸑鸕鸘鸚鸛鸝鸞鹵鹹鹺鹼鹽麗麥麩麪麫麬麯麳麴麵麼麽黃黌點黨黲黴黶黷黽黿鼂鼉鼕鼴齊齋齎齏齒齔齕齗齘齙齜齟齠齡齣齦齧齪齬齮齯齲齶齷齼龍龎龐龑龔龕龜鿁鿓");
  // ── GENERATED:ZH-CHAR-SETS END ──

  const NON_CHINESE_LANG_PREFIX = /^(ja|ko)\b/i;

  SK.detectTextLang = function detectTextLang(text) {
    const htmlLang = document.documentElement.lang || '';
    if (/^ja\b/i.test(htmlLang)) return 'ja';
    if (/^ko\b/i.test(htmlLang)) return 'ko';

    const lettersOnly = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
    if (lettersOnly.length === 0) return 'other';

    let cjkCount = 0;
    let simpCount = 0;
    let tradCount = 0;
    let kanaCount = 0;
    let hangulCount = 0;
    let asciiLetterCount = 0;

    for (const ch of lettersOnly) {
      const code = ch.codePointAt(0);
      if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF)) {
        cjkCount++;
        if (SIMPLIFIED_ONLY_CHARS.has(ch)) simpCount++;
        if (TRADITIONAL_ONLY_CHARS.has(ch)) tradCount++;
      } else if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF)) {
        kanaCount++;
      } else if (code >= 0xAC00 && code <= 0xD7AF) {
        hangulCount++;
      } else if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) {
        asciiLetterCount++;
      }
    }

    if (hangulCount > 0 && hangulCount / lettersOnly.length > 0.05) return 'ko';
    if (kanaCount > 0 && kanaCount / lettersOnly.length > 0.05) return 'ja';

    const cjkRatio = cjkCount / lettersOnly.length;
    if (cjkRatio >= 0.5) {
      if (simpCount > 0 && tradCount === 0) return 'zh-Hans';
      if (tradCount > 0 && simpCount === 0) return 'zh-Hant';
      if (cjkCount > 0 && simpCount / cjkCount >= 0.2) return 'zh-Hans';
      return 'zh-Hant';
    }

    if (cjkRatio < 0.05 && asciiLetterCount / lettersOnly.length >= 0.5) return 'en';

    return 'other';
  };

  // 目標語言對應的繁簡轉換方向; 非中文目標回傳 null.
  SK.convertDirectionFor = function convertDirectionFor(target) {
    return target === 'zh-TW' ? 'cn2twp' : (target === 'zh-CN' ? 'twp2cn' : null);
  };

  const _SIMP_ONLY_RE = new RegExp('[' + Array.from(SIMPLIFIED_ONLY_CHARS).join('') + ']', 'u');
  const _ANY_CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF]/u;
  SK.pageHasConvertibleSignal = function pageHasConvertibleSignal(direction, root) {
    if (direction !== 'cn2twp' && direction !== 'twp2cn') return false;
    const re = direction === 'cn2twp' ? _SIMP_ONLY_RE : _ANY_CJK_RE;
    const scope = root || document.body;
    if (!scope) return false;
    if (re.test(scope.textContent || '')) return true;
    if (typeof SK.findOpenShadowRoots === 'function') {
      for (const sr of SK.findOpenShadowRoots(scope)) {
        if (re.test(sr.textContent || '')) return true;
      }
    }
    return false;
  };

  SK.isConvertibleVariant = function isConvertibleVariant(text, direction) {
    if (direction !== 'cn2twp' && direction !== 'twp2cn') return false;
    const wantLang = direction === 'cn2twp' ? 'zh-Hans' : 'zh-Hant';
    if (SK.detectTextLang(text) === wantLang) return true;
    const lettersOnly = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
    if (lettersOnly.length === 0) return false;
    let cjkCount = 0, simpCount = 0, tradCount = 0;
    for (const ch of lettersOnly) {
      const code = ch.codePointAt(0);
      if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF)) {
        cjkCount++;
        if (SIMPLIFIED_ONLY_CHARS.has(ch)) simpCount++;
        if (TRADITIONAL_ONLY_CHARS.has(ch)) tradCount++;
      }
    }
    if (cjkCount < 2 || cjkCount / lettersOnly.length < 0.3) return false;
    return direction === 'cn2twp'
      ? (simpCount > 0 && tradCount === 0)
      : (tradCount > 0 && simpCount === 0);
  };

  SK.isAlreadyInTarget = function isAlreadyInTarget(text, target) {
    const detected = SK.detectTextLang(text);
    if (target === 'zh-TW') return detected === 'zh-Hant';
    if (target === 'zh-CN') return detected === 'zh-Hans';
    if (target === 'en')    return detected === 'en';
    if (target === 'ja')    return detected === 'ja';
    if (target === 'ko')    return detected === 'ko';
    return false;
  };

  SK.isTraditionalChinese = function isTraditionalChinese(text) {
    return SK.isAlreadyInTarget(text, 'zh-TW');
  };

  const LATIN_SCRIPT_TARGETS = new Set(['en', 'es', 'fr', 'de']);
  SK.isWrongLanguageOutput = function isWrongLanguageOutput(text, target) {
    if (!text || typeof text !== 'string') return false;
    if (!LATIN_SCRIPT_TARGETS.has(target)) return false;
    const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
    if (letters.length === 0) return false;
    let ea = 0;
    for (const ch of letters) {
      const c = ch.codePointAt(0);
      if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)
          || (c >= 0x3040 && c <= 0x30FF)
          || (c >= 0xAC00 && c <= 0xD7AF)) {
        ea++;
      }
    }
    return ea / letters.length >= 0.5;
  };

  const _CJK_RE = /[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/;
  function _buttonThreshold(text) { return _CJK_RE.test(text) ? 3 : 8; }

  function _hasVisibleText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      let p = n.parentElement;
      let hidden = false;
      while (p && p !== root) {
        if (!SK.isVisible(p)) { hidden = true; break; }
        p = p.parentElement;
      }
      if (!hidden) return true;
    }
    return false;
  }

  function getElementLangHint(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const _skStamped = cur.hasAttribute && cur.hasAttribute('data-transit-translated');
      if (!_skStamped) {
        if (typeof cur.lang === 'string' && cur.lang) return cur.lang.toLowerCase();
        const attr = cur.getAttribute && cur.getAttribute('lang');
        if (attr) return attr.toLowerCase();
      }
      cur = cur.parentElement;
    }
    return null;
  }
  SK._getElementLangHint = getElementLangHint;

  function langHintDecision(langHint, target) {
    if (!langHint) return 'unknown';
    const isZhHant = /^zh-(hant|tw|hk|mo)$/i.test(langHint);
    const isZhHans = langHint === 'zh' || /^zh-(hans|cn|sg)$/i.test(langHint);
    if (target === 'zh-TW') {
      if (isZhHant) return 'skip';
      if (isZhHans) return 'translate';
    } else if (target === 'zh-CN') {
      if (isZhHans) return 'skip';
      if (isZhHant) return 'translate';
    } else if (target === 'en') {
      if (/^en\b/i.test(langHint)) return 'skip';
    } else if (target === 'ja') {
      if (/^ja\b/i.test(langHint)) return 'skip';
    } else if (target === 'ko') {
      if (/^ko\b/i.test(langHint)) return 'skip';
    }
    return 'unknown';
  }
  SK._langHintDecision = langHintDecision;

  function isCandidateText(el) {
    const text = el.textContent?.trim();
    if (!text || text.length < 2) return false;
    if (!/[\p{L}]/u.test(text)) return false;
    const target = SK.STATE?.targetLanguage || 'zh-TW';
    const langHint = getElementLangHint(el);
    const decision = langHintDecision(langHint, target);
    if (decision === 'skip') return false;
    if (decision === 'translate') return true;
    if (SK.isAlreadyInTarget(text, target)) return false;
    return true;
  }

  function isContentFooter(el) {
    if (!el || el.tagName !== 'FOOTER') return false;
    if (el.querySelector('.wp-block-query, .wp-block-post-title, .wp-block-post')) return true;
    let cur = el.parentElement;
    while (cur && cur !== document.body) {
      if (cur.tagName === 'ARTICLE' || cur.tagName === 'MAIN') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  const _MONOSPACE_FONT_RE = /(?:^|[\s,'"])(monospace|Menlo|Consolas|Monaco|Courier|Fira\s+(?:Code|Mono)|Source\s+Code|JetBrains\s+Mono|Cascadia|Roboto\s+Mono|SFMono|SF\s+Mono|ui-monospace)(?:[\s,'"]|$)/i;

  const PROSE_INLINE_TAGS = new Set(['A', 'EM', 'STRONG', 'I', 'B', 'CITE', 'Q', 'MARK', 'SMALL', 'INS', 'DEL', 'U']);

  const INLINE_PROSE_WRAPPER_SELECTOR = 'b, strong, i, em, u, font, mark, cite';

  const PURE_IDENTIFIER_RE = /^[\w./\-]+$/;
  const FILENAME_HINT_RE = /[./\-]/;
  function isPureIdentifierCell(el) {
    const text = (el.textContent || '').trim();
    if (text.length === 0 || text.length >= 40) return false;
    if (!PURE_IDENTIFIER_RE.test(text)) return false;
    if (FILENAME_HINT_RE.test(text)) return true;
    if (el.querySelector('svg, img')) return true;
    return false;
  }

  const DATE_PATTERNS = [
    /^[A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4}$/,
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/,
    /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/,
    /^\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago$/i,
    /^last\s+(?:week|month|year)$/i,
    /^(?:yesterday|today|now)$/i,
    /^\d+\s+(?:minute|hour|day|week|month|year)s?$/i,
  ];
  const _DATE_SAMPLE_CAP = 200;
  function _sampleShortText(el) {
    const doc = el.ownerDocument || document;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let out = '';
    let n;
    while ((n = walker.nextNode())) {
      out += n.nodeValue;
      if (out.length >= _DATE_SAMPLE_CAP) return null;
    }
    return out;
  }
  function isDateLikeText(el) {
    if (el.childElementCount > 3) return false;
    const sample = _sampleShortText(el);
    if (sample === null) return false;
    const text = sample.trim();
    if (text.length === 0 || text.length >= 30) return false;
    return DATE_PATTERNS.some((re) => re.test(text));
  }
  SK._isDateLikeText = isDateLikeText;
  function isCodeContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'PRE') return false;
    const cs = SK.getCS(el);
    if (!cs) return false;
    const ws = cs.whiteSpace || '';
    if (ws !== 'pre' && ws !== 'pre-wrap' && ws !== 'break-spaces') return false;
    const ff = cs.fontFamily || '';
    return _MONOSPACE_FONT_RE.test(ff);
  }

  let _bodyTextLenCache = { t: 0, len: 0 };
  function isDocumentLevelNoTranslate(el) {
    if (!el.children || el.children.length === 0) return false;
    const now = Date.now();
    if (now - _bodyTextLenCache.t > 1000) {
      _bodyTextLenCache = { t: now, len: (document.body?.textContent || '').length };
    }
    const bodyLen = _bodyTextLenCache.len;
    if (bodyLen === 0) return false;
    return (el.textContent || '').length * 2 >= bodyLen;
  }

  function isInsideExcludedContainer(el, memo, stopAt) {
    if (memo && memo.has(el)) return memo.get(el);

    const visited = [];
    let cur = el;
    let result = false;
    let yesIdx = -1;
    while (cur && cur !== document.body && cur !== stopAt) {
      if (memo && yesIdx < 0 && memo.has(cur)) {
        result = memo.get(cur);
        break;
      }
      visited.push(cur);

      const tag = cur.tagName;
      {
        const _tr = cur.getAttribute && cur.getAttribute('translate');
        if (_tr != null && _tr.trim().toLowerCase() === 'yes') {
          if (yesIdx < 0) yesIdx = visited.length - 1;
        } else if (yesIdx < 0 && SK.isNoTranslateMarked(cur) && !isDocumentLevelNoTranslate(cur)) {
          result = true; break;
        }
        if (cur === el && SK.isIconFontLigature(cur)) { result = true; break; }
      }
      if (tag === 'FOOTER' && isContentFooter(cur)) {
        cur = cur.parentElement;
        continue;
      }
      {
        const _role = cur.getAttribute && cur.getAttribute('role');
        if ((tag === 'FOOTER' || _role === 'contentinfo') && SK.isConvertibleVariant) {
          const _t = SK.STATE?.targetLanguage || 'zh-TW';
          const _dir = SK.convertDirectionFor(_t);
          if (_dir && SK.isConvertibleVariant((cur.textContent || '').slice(0, 400), _dir)) {
            cur = cur.parentElement;
            continue;
          }
        }
      }
      if (tag && SK.SEMANTIC_CONTAINER_EXCLUDE_TAGS.has(tag)) { result = true; break; }
      if (tag === 'TRANSIT-TRANSLATION') { result = true; break; }
      if (isCodeContainer(cur)) { result = true; break; }
      const role = cur.getAttribute && cur.getAttribute('role');
      if (role && SK.EXCLUDE_ROLES.has(role)) { result = true; break; }
      if (tag === 'HEADER' && role === 'banner') { result = true; break; }
      if (cur.getAttribute && cur.getAttribute('contenteditable') === 'true') { result = true; break; }
      if (role === 'textbox') { result = true; break; }
      cur = cur.parentElement;
    }

    if (memo) {
      const cacheUpTo = yesIdx >= 0 ? yesIdx + 1 : visited.length;
      for (let i = 0; i < cacheUpTo; i++) memo.set(visited[i], result);
    }
    return result;
  }

  function isInteractiveWidgetContainer(el) {
    if (directTextLength(el) >= 100) return false;
    const buttons = el.querySelectorAll('button, [role="button"]');
    if (buttons.length === 0) return false;
    let nonUtilityCount = 0;
    for (const btn of buttons) {
      if (btn.tagName === 'A' && btn.getAttribute('role') === 'button') {
        const ariaHaspopup = btn.getAttribute('aria-haspopup');
        const isPopupTrigger = ariaHaspopup && ariaHaspopup !== 'false';
        const href = btn.getAttribute('href');
        const hasRealHref = href && href !== '#' && !href.startsWith('javascript:');
        if (hasRealHref && !isPopupTrigger) continue;
      }
      let cur = btn;
      let isCodeUtility = false;
      while (cur && cur !== el && cur.parentElement) {
        const parent = cur.parentElement;
        for (const sib of parent.children) {
          if (sib === cur) continue;
          if (sib.tagName === 'PRE' || (sib.querySelector && sib.querySelector('pre'))) {
            isCodeUtility = true;
            break;
          }
        }
        if (isCodeUtility) break;
        cur = parent;
      }
      if (!isCodeUtility) nonUtilityCount++;
    }
    if (nonUtilityCount === 0) return false;
    const textLen = (el.innerText || '').trim().length;
    if (textLen >= 300) return false;
    return true;
  }

  function hasBrChild(el) {
    for (const child of el.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'BR') return true;
    }
    return false;
  }

  function directTextLength(el) {
    let total = 0;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) total += child.nodeValue.trim().length;
    }
    return total;
  }

  function hasDirectNonBrElement(el) {
    for (const child of el.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.tagName === 'BR') continue;
      return true;
    }
    return false;
  }

  function hasAncestorExtracted(el, fragmentExtracted) {
    let cur = el.parentElement;
    let crossedBlock = false;
    while (cur && cur !== document.body) {
      if (fragmentExtracted.has(cur)) {
        if (crossedBlock) { cur = cur.parentElement; continue; }
        return true;
      }
      if (SK.BLOCK_TAGS_SET.has(cur.tagName)) crossedBlock = true;
      cur = cur.parentElement;
    }
    return false;
  }

  function extractInlineFragments(el, opts) {
    const containerBoundary = !!(opts && opts.containerBoundary);
    const requireDirectText = !!(opts && opts.requireDirectText);
    const extraBoundary = (opts && opts.extraBoundary) || null;
    const fragments = [];
    const children = Array.from(el.childNodes);
    let runStart = null;
    let runEnd = null;

    const flushRun = () => {
      if (!runStart) return;
      let text = '';
      let n = runStart;
      while (n) {
        text += n.textContent || '';
        if (n === runEnd) break;
        n = n.nextSibling;
      }
      const trimmed = text.trim();
      const _target = SK.STATE?.targetLanguage || 'zh-TW';
      if (trimmed.length >= 2 && SK.isAlreadyInTarget(trimmed, _target)) {
        runStart = null;
        runEnd = null;
        return;
      }
      if (SK.hasSubstantiveText(text)) {
        let _elCount = 0, _wrapperEl = null, _directTextLen = 0;
        { let _n = runStart;
          while (_n) {
            if (_n.nodeType === 1) { _elCount++; _wrapperEl = _n; }
            else if (_n.nodeType === 3) { _directTextLen += (_n.textContent || '').trim().length; }
            if (_n === runEnd) break;
            _n = _n.nextSibling;
          }
        }
        if (_elCount === 1 && _wrapperEl && _wrapperEl.children.length > 0 &&
            trimmed.length >= 100 && _directTextLen < 20) {
          runStart = null; runEnd = null;
          return;
        }
        if (requireDirectText && _directTextLen < 2) {
          runStart = null; runEnd = null;
          return;
        }
        fragments.push({
          kind: 'fragment',
          el,
          startNode: runStart,
          endNode: runEnd,
        });
      }
      runStart = null;
      runEnd = null;
    };

    for (const child of children) {
      const isBoundaryContainer = (containerBoundary &&
        child.nodeType === Node.ELEMENT_NODE && SK.CONTAINER_TAGS.has(child.tagName)) ||
        (extraBoundary && extraBoundary(child));
      if (!isBoundaryContainer && SK.isInlineRunNode(child)) {
        if (!runStart) runStart = child;
        runEnd = child;
      } else {
        flushRun();
      }
    }
    flushRun();
    return fragments;
  }

  function splitBrBlock(el) {
    const fragments = [];
    const children = Array.from(el.childNodes);
    const isBr = (n) => n && n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR';
    const isWs = (n) => n && n.nodeType === Node.TEXT_NODE && !(n.nodeValue || '').trim();
    const _target = SK.STATE?.targetLanguage || 'zh-TW';

    let runStart = null;
    let runEnd = null;

    const flush = () => {
      if (!runStart) return;
      let text = '';
      let n = runStart;
      while (n) { text += n.textContent || ''; if (n === runEnd) break; n = n.nextSibling; }
      const trimmed = text.trim();
      if (trimmed.length >= 2 &&
          !SK.isAlreadyInTarget(trimmed, _target) &&
          SK.hasSubstantiveText(text)) {
        fragments.push({ kind: 'fragment', el, startNode: runStart, endNode: runEnd });
      }
      runStart = null;
      runEnd = null;
    };

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isBr(child)) {
        let j = i + 1;
        let brCount = 1;
        while (j < children.length && (isBr(children[j]) || isWs(children[j]))) {
          if (isBr(children[j])) brCount++;
          j++;
        }
        if (brCount >= 2) {
          flush();
          i = j - 1;
          continue;
        }
        continue;
      }
      if (isWs(child)) continue;
      if (!runStart) runStart = child;
      runEnd = child;
    }
    flush();
    return fragments;
  }
  SK._splitBrBlock = splitBrBlock;

  function findBrSplitTarget(el) {
    let cur = el;
    for (let depth = 0; depth < 4; depth++) {
      if (hasBrChild(cur)) return cur;
      let onlyChild = null;
      let hasDirectText = false;
      let multiple = false;
      for (const c of cur.childNodes) {
        if (c.nodeType === Node.TEXT_NODE) {
          if ((c.nodeValue || '').trim().length >= 2) hasDirectText = true;
          continue;
        }
        if (c.nodeType !== Node.ELEMENT_NODE) continue;
        if (c.tagName === 'BR') continue;
        if (onlyChild) { multiple = true; break; }
        onlyChild = c;
      }
      if (hasDirectText || multiple || !onlyChild) return null;
      if (SK.BLOCK_TAGS_SET.has(onlyChild.tagName) || SK.CONTAINER_TAGS.has(onlyChild.tagName)) return null;
      cur = onlyChild;
    }
    return null;
  }
  SK._findBrSplitTarget = findBrSplitTarget;

  // 已經有雙語譯文的元素 (或其內部) 注入時一律跳過, 收集時先排除, 避免 rescan 重複送翻.
  function dropDualSourceUnits(units) {
    return units.filter((u) => {
      const anchor = u.kind === 'fragment' ? u.startNode?.parentElement : u.el;
      return !anchor?.closest?.('[data-transit-dual-source]');
    });
  }

  SK.collectParagraphs = function collectParagraphs(root, stats, opts) {
    SK.beginStyleMemo();
    try {
      const scopeRoots = root ? null : SK.getScopeRoots?.();
      if (scopeRoots) {
        const results = [];
        for (const r of scopeRoots) {
          results.push(..._collectParagraphsImpl(r, stats, { ...opts, includeRoot: true }));
        }
        return dropDualSourceUnits(results);
      }
      return dropDualSourceUnits(_collectParagraphsImpl(root, stats, opts));
    } finally {
      SK.endStyleMemo();
    }
  };
  function _collectParagraphsImpl(root, stats, opts) {
    root = root || document.body;
    stats = stats || null;
    const pathTo = (opts && opts.pathTo && opts.pathTo.nodeType === Node.ELEMENT_NODE) ? opts.pathTo : null;
    let _pathSet = null;
    let _pathShadowRoots = null;
    if (pathTo) {
      _pathSet = new Set();
      _pathShadowRoots = [];
      let _n = pathTo;
      let _belowRoot = true;
      while (_n) {
        _pathSet.add(_n);
        if (_n === root) _belowRoot = false;
        if (_belowRoot && typeof ShadowRoot !== 'undefined' && _n instanceof ShadowRoot) _pathShadowRoots.push(_n);
        _n = _n.parentNode || _n.host || null;
      }
    }
    const onPath = (el) => !_pathSet || _pathSet.has(el);
    const qsaOnPath = (scope, selector) => {
      if (!_pathSet) return scope.querySelectorAll(selector);
      const out = [];
      let _n = pathTo;
      while (_n && _n !== scope) {
        if (_n.nodeType === Node.ELEMENT_NODE && _n.matches && _n.matches(selector)) out.push(_n);
        _n = _n.parentNode || _n.host || null;
      }
      if (_n !== scope) return [];
      return out.reverse();
    };
    let _shadowRootsCache = null;
    const _getShadowRoots = () => {
      if (_shadowRootsCache === null) {
        _shadowRootsCache = _pathShadowRoots
          ? _pathShadowRoots
          : ((typeof SK.findOpenShadowRoots === 'function') ? SK.findOpenShadowRoots(root) : []);
      }
      return _shadowRootsCache;
    };
    const includeRoot = !!(opts && opts.includeRoot);

    {
      const _t = SK.STATE?.targetLanguage || 'zh-TW';
      const _dir = SK.convertDirectionFor(_t);
      if (_dir && SK.isConvertibleVariant) {
        let _staleCount = 0;
        const _reconcileScope = (scope) => {
        for (const el of qsaOnPath(scope, '[data-transit-translated], [data-transit-nodevalue-mutated]')) {
          if (!onPath(el)) continue;
          if (el.getAttribute('contenteditable') === 'true') continue;
          if (el.hasAttribute('data-transit-dual-source')) continue;
          if (el.querySelector('transit-translation')) continue;
          const _txt = (el.textContent || '').slice(0, 400).trim();
          if (!_txt || !SK.isConvertibleVariant(_txt, _dir)) continue;
          el.removeAttribute('data-transit-translated');
          el.removeAttribute('data-transit-nodevalue-mutated');
          const _elLang = el.getAttribute('lang');
          if (_elLang && langHintDecision(_elLang.toLowerCase(), _t) === 'skip') {
            el.removeAttribute('lang');
          }
          const S = SK.STATE;
          S.originalHTML?.delete?.(el);
          S.originalText?.delete?.(el);
          S.translatedHTML?.delete?.(el);
          S.nodeValueMutateBackup?.delete?.(el);
          S.nvMutateTranslation?.delete?.(el);
          _staleCount++;
        }
        };
        _reconcileScope(root);
        for (const _sr of _getShadowRoots()) _reconcileScope(_sr);
        if (_staleCount > 0) {
          SK.sendLog?.('info', 'detect', 'stale conversion markers reconciled (framework-reused elements unmarked)', { count: _staleCount });
          if (stats) stats.staleMarkerReconciled = _staleCount;
        }
      }
    }

    const results = [];
    const seen = new Set();
    // fragment 加入結果, 並把 startNode..endNode 之間的元素標記為已處理.
    const pushFragment = (f) => {
      results.push(f);
      seen.add(f.startNode);
      let _n = f.startNode;
      while (_n) { if (_n.nodeType === 1) seen.add(_n); if (_n === f.endNode) break; _n = _n.nextSibling; }
    };
    const fragmentExtracted = new Set();
    const _foreignPage = (() => {
      const _langBackup = SK.STATE?.docLangBackup;
      const hl = ((_langBackup ? (_langBackup.orig || '') : (document.documentElement.lang || '')) + '').toLowerCase();
      const t = SK.STATE?.targetLanguage || 'zh-TW';
      if (!hl) {
        const detected = SK.detectTextLang(document.title || '');
        if (t === 'zh-TW' && detected === 'zh-Hans') return true;
        if (t === 'zh-CN' && detected === 'zh-Hant') return true;
        return false;
      }
      if (t === 'zh-TW' && /^zh-(hant|tw|hk|mo)$/i.test(hl)) return false;
      if (t === 'zh-CN' && (hl === 'zh' || /^zh-(hans|cn|sg)$/i.test(hl))) return false;
      if (t !== 'zh-TW' && t !== 'zh-CN') {
        if (hl.startsWith(t.split('-')[0].toLowerCase())) return false;
      }
      return true;
    })();
    const _selfContainerMinText = _foreignPage ? 2 : 20;
    function isSelfCollectingContainer(d) {
      return SK.CONTAINER_TAGS.has(d.tagName) && directTextLength(d) >= _selfContainerMinText;
    }
    function containsSelfCollectingContainer(el) {
      for (const d of el.querySelectorAll(SK.CONTAINER_OUTSIDE_WRAPPER_SELECTOR)) {
        if (isSelfCollectingContainer(d)) return true;
      }
      return false;
    }
    const _selfContainerBoundary = (n) => n.nodeType === Node.ELEMENT_NODE &&
      (isSelfCollectingContainer(n) || containsSelfCollectingContainer(n));
    const excludedMemo = new Map();
    const blockAncestorMemo = new Map();
    const widgetRejectedBlocks = new Set();
    const structurallySkippedBlocks = new Set();
    const shortBlockRejectedBlocks = new Set();
    function hasBlockAncestor(el) {
      if (blockAncestorMemo.has(el)) return blockAncestorMemo.get(el);
      const chain = [];
      let cur = el.parentElement;
      let result = false;
      while (cur && cur !== document.body) {
        if (blockAncestorMemo.has(cur)) {
          result = blockAncestorMemo.get(cur);
          break;
        }
        chain.push(cur);
        if (SK.BLOCK_TAGS_SET.has(cur.tagName) &&
            !widgetRejectedBlocks.has(cur) &&
            !structurallySkippedBlocks.has(cur)) {
          result = true;
          break;
        }
        cur = cur.parentElement;
      }
      for (const node of chain) blockAncestorMemo.set(node, result);
      blockAncestorMemo.set(el, result);
      return result;
    }

    function processScope(scopeRoot, _includeRootCandidate) {
    const _walkerFilter = {
      acceptNode(el) {
        if (!onPath(el)) return NodeFilter.FILTER_REJECT;
        if (el.tagName === 'BUTTON') {
          const _bt = (el.textContent || '').trim();
          if (_bt.length >= _buttonThreshold(_bt)) {
            if (stats) stats.longTextButton = (stats.longTextButton || 0) + 1;
            return NodeFilter.FILTER_SKIP;
          }
          if (stats) stats.hardExcludeTag = (stats.hardExcludeTag || 0) + 1;
          return NodeFilter.FILTER_REJECT;
        }
        if (SK.HARD_EXCLUDE_TAGS.has(el.tagName)) {
          if (stats) stats.hardExcludeTag = (stats.hardExcludeTag || 0) + 1;
          return NodeFilter.FILTER_REJECT;
        }
        if (el.tagName === 'PRE') {
          if (el.querySelector('code')) {
            if (stats) stats.hardExcludeTag = (stats.hardExcludeTag || 0) + 1;
            return NodeFilter.FILTER_REJECT;
          }
          let spanCount = 0;
          let hasProseInline = false;
          for (const child of el.children) {
            if (child.tagName === 'SPAN') spanCount++;
            else if (PROSE_INLINE_TAGS.has(child.tagName)) hasProseInline = true;
          }
          if (spanCount >= 2 && !hasProseInline) {
            if (stats) stats.hardExcludeTag = (stats.hardExcludeTag || 0) + 1;
            return NodeFilter.FILTER_REJECT;
          }
        }
        if (el.hasAttribute('data-transit-translated') || el.hasAttribute('data-transit-dual-source')) {
          if (stats) stats.alreadyTranslated = (stats.alreadyTranslated || 0) + 1;
          return NodeFilter.FILTER_REJECT;
        }
        if ((el.tagName === 'TD' || el.tagName === 'TH') && isPureIdentifierCell(el)) {
          if (stats) stats.pureIdentifierCell = (stats.pureIdentifierCell || 0) + 1;
          return NodeFilter.FILTER_REJECT;
        }
        if (isDateLikeText(el)) {
          if (stats) stats.dateLikeCell = (stats.dateLikeCell || 0) + 1;
          return NodeFilter.FILTER_REJECT;
        }
        const _isBlockTag = SK.BLOCK_TAGS_SET.has(el.tagName);
        let hasDirectText = false;
        if (!_isBlockTag) {
          for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim().length >= 2) {
              hasDirectText = true;
              break;
            }
          }
          if (!hasDirectText && el.children.length < 3) {
            if (stats) stats.notBlockTag = (stats.notBlockTag || 0) + 1;
            return NodeFilter.FILTER_SKIP;
          }
        }
        {
          const _cs = SK.getCS(el);
          if (_cs && _cs.fontSize === '0px') {
            if (stats) stats.fontSizeZero = (stats.fontSizeZero || 0) + 1;
            return NodeFilter.FILTER_SKIP;
          }
        }
        if (!_isBlockTag) {
          if (stats) stats.notBlockTag = (stats.notBlockTag || 0) + 1;
          if (!fragmentExtracted.has(el) && SK.isVisible(el) && !isInsideExcludedContainer(el, excludedMemo)) {
            if (hasDirectText && (SK.containsBlockDescendant(el) || containsSelfCollectingContainer(el))) {
              const frags = extractInlineFragments(el, { extraBoundary: _selfContainerBoundary });
              if (frags.length > 0) {
                fragmentExtracted.add(el);
                SK.snapshotOnce?.(el);
                for (const f of frags) {
                  pushFragment(f);
                  if (stats) stats.fragmentUnit = (stats.fragmentUnit || 0) + 1;
                }
              }
            } else if (
              SK.CONTAINER_TAGS.has(el.tagName) &&
              !seen.has(el) &&
              hasBrChild(el) &&
              directTextLength(el) >= 20 &&
              isCandidateText(el)
            ) {
              let splitFrags = null;
              if ((el.textContent || '').trim().length > SK.BR_BLOCK_SPLIT_CHARS) {
                const fr = splitBrBlock(el);
                if (fr.length >= 2) splitFrags = fr;
              }
              if (splitFrags) {
                fragmentExtracted.add(el);
                SK.snapshotOnce?.(el);
                for (const f of splitFrags) {
                  pushFragment(f);
                  if (stats) stats.containerWithBrSplit = (stats.containerWithBrSplit || 0) + 1;
                }
              } else {
                results.push({ kind: 'element', el });
                seen.add(el);
                fragmentExtracted.add(el);
                if (stats) stats.containerWithBr = (stats.containerWithBr || 0) + 1;
              }
            } else if (
              SK.CONTAINER_TAGS.has(el.tagName) &&
              !seen.has(el) &&
              hasDirectText &&
              directTextLength(el) >= (_foreignPage ? 2 : 20) &&
              isCandidateText(el)
            ) {
              const frags = extractInlineFragments(el);
              if (frags.length > 0) {
                fragmentExtracted.add(el);
                for (const f of frags) {
                  pushFragment(f);
                  if (stats) stats.inlineMixedFragment = (stats.inlineMixedFragment || 0) + 1;
                }
              }
            } else if (
              el.tagName === 'SPAN' &&
              !seen.has(el) &&
              !hasAncestorExtracted(el, fragmentExtracted) &&
              hasDirectText &&
              hasDirectNonBrElement(el) &&
              (() => {
                const _total = (el.textContent || '').trim();
                const _cjk = (_total.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g) || []).length;
                const _cjkDominant = _cjk >= 5 && _cjk * 2 >= _total.length;
                const _t = _cjkDominant ? 10 : 20;
                return directTextLength(el) >= _t ||
                  (directTextLength(el) >= (_cjkDominant ? 2 : 5) && _total.length >= _t);
              })() &&
              isCandidateText(el)
            ) {
              const frags = extractInlineFragments(el);
              if (frags.length > 0) {
                fragmentExtracted.add(el);
                for (const f of frags) {
                  pushFragment(f);
                  if (stats) stats.inlineMixedSpan = (stats.inlineMixedSpan || 0) + 1;
                }
              }
            } else if (
              el.tagName === 'SPAN' &&
              !seen.has(el) &&
              !hasAncestorExtracted(el, fragmentExtracted) &&
              hasDirectText &&
              hasBrChild(el) &&
              !hasDirectNonBrElement(el) &&
              (() => {
                const _t = _foreignPage ? 2 : 20;
                return directTextLength(el) >= _t ||
                  (directTextLength(el) >= 2 && (el.textContent || '').trim().length >= _t);
              })() &&
              isCandidateText(el)
            ) {
              results.push({ kind: 'element', el });
              seen.add(el);
              fragmentExtracted.add(el);
              if (stats) stats.spanWithBr = (stats.spanWithBr || 0) + 1;
            } else if (
              !seen.has(el) &&
              !fragmentExtracted.has(el) &&
              (() => {
                const selfCs = SK.getCS(el);
                const selfDsp = selfCs?.display;
                if (selfDsp !== 'block' && selfDsp !== 'flex' && selfDsp !== 'grid'
                    && selfDsp !== 'list-item') return false;
                const directChildren = Array.from(el.children);
                if (directChildren.length < 3) return false;
                let wrapperChildCount = 0;
                for (const c of directChildren) {
                  const dcs = SK.getCS(c);
                  const dsp = dcs?.display;
                  if (dsp !== 'inline' && dsp !== 'inline-block' && dsp !== 'inline-flex') {
                    return false;
                  }
                  if (c.children.length > 0 && !SK.PRESERVE_INLINE_TAGS.has(c.tagName)) wrapperChildCount++;
                }
                return wrapperChildCount >= 1;
              })()
            ) {
              if (stats) stats.multiSegmentInlineBlock = (stats.multiSegmentInlineBlock || 0) + 1;
              widgetRejectedBlocks.add(el);
              fragmentExtracted.add(el);
              const leaves = el.querySelectorAll('span:not(:has(*))');
              for (const leaf of leaves) {
                if (seen.has(leaf)) continue;
                if (leaf.hasAttribute('data-transit-translated')) continue;
                const text = (leaf.textContent || '').trim();
                if (text.length < 2) continue;
                if (!SK.isVisible(leaf)) continue;
                if (!isCandidateText(leaf)) continue;
                if (isInsideExcludedContainer(leaf, excludedMemo)) continue;
                results.push({ kind: 'element', el: leaf });
                seen.add(leaf);
              }
              for (const s of el.querySelectorAll('span')) {
                if (seen.has(s) || fragmentExtracted.has(s)) continue;
                let _anc = s.parentElement, _ancExtracted = false;
                while (_anc && _anc !== el) {
                  if (fragmentExtracted.has(_anc)) { _ancExtracted = true; break; }
                  _anc = _anc.parentElement;
                }
                if (_ancExtracted) continue;
                if (s.children.length === 0) continue;
                if (directTextLength(s) < 2) continue;
                if (!SK.isVisible(s)) continue;
                if (!isCandidateText(s)) continue;
                const frags = extractInlineFragments(s);
                if (frags.length === 0) continue;
                fragmentExtracted.add(s);
                for (const f of frags) {
                  pushFragment(f);
                  if (stats) stats.multiSegmentWrapperFragment = (stats.multiSegmentWrapperFragment || 0) + 1;
                }
              }
              for (const a of el.querySelectorAll('a')) {
                const _hasDetectedLeaf = [...a.querySelectorAll('span:not(:has(*))')].some(s => seen.has(s));
                if (_hasDetectedLeaf) seen.add(a);
              }
            }
          }
          return NodeFilter.FILTER_SKIP;
        }
        if (isInsideExcludedContainer(el, excludedMemo)) {
          if (stats) stats.excludedContainer = (stats.excludedContainer || 0) + 1;
          return NodeFilter.FILTER_REJECT;
        }
        if (!SK.WIDGET_CHECK_EXEMPT_TAGS.has(el.tagName) && isInteractiveWidgetContainer(el)) {
          if (stats) stats.interactiveWidget = (stats.interactiveWidget || 0) + 1;
          if (SK.BLOCK_TAGS_SET.has(el.tagName)) widgetRejectedBlocks.add(el);
          return NodeFilter.FILTER_SKIP;
        }
        if (!SK.isVisible(el)) {
          if (stats) stats.invisible = (stats.invisible || 0) + 1;
          return NodeFilter.FILTER_REJECT;
        }
        if (!fragmentExtracted.has(el)) {
          const containerKids = Array.from(el.children).filter(c =>
            SK.CONTAINER_TAGS.has(c.tagName));
          if (containerKids.length > 0) {
            let capturedLinks = 0;
            let deferredProseContainer = false;
            for (const container of containerKids) {
              const _containerHasLink = Array.from(container.children).some(c => c.tagName === 'A');
              if (_containerHasLink && directTextLength(container) >= (_foreignPage ? 2 : 20)) {
                deferredProseContainer = true;
                continue;
              }
              for (const child of Array.from(container.children)) {
                if (child.tagName !== 'A') continue;
                if (seen.has(child)) continue;
                if (child.hasAttribute('data-transit-translated')) continue;
                if (!SK.isVisible(child)) continue;
                if (!isCandidateText(child)) continue;
                results.push({ kind: 'element', el: child });
                seen.add(child);
                capturedLinks++;
                if (stats) stats.blockContainerLink = (stats.blockContainerLink || 0) + 1;
              }
            }
            if (capturedLinks > 0 || deferredProseContainer) {
              if (capturedLinks > 0) {
                fragmentExtracted.add(el);
                if (SK.BLOCK_TAGS_SET.has(el.tagName)) structurallySkippedBlocks.add(el);
              }
              if (stats) stats.skipBlockWithContainer = (stats.skipBlockWithContainer || 0) + 1;
              return NodeFilter.FILTER_SKIP;
            }
          }
        }
        if (
          !/^H[1-6]$/.test(el.tagName) &&
          el.querySelector('img, picture, video') &&
          (Array.from(el.children).some(c => SK.CONTAINER_TAGS.has(c.tagName))
           || !!el.querySelector(SK.CONTAINER_TAG_SELECTOR)) &&
          directTextLength(el) < 20
        ) {
          if (stats) stats.mediaCardSkip = (stats.mediaCardSkip || 0) + 1;
          if (!fragmentExtracted.has(el)) {
            const frags = extractInlineFragments(el, { containerBoundary: true, requireDirectText: true });
            if (frags.length > 0) {
              fragmentExtracted.add(el);
              for (const f of frags) {
                pushFragment(f);
                if (stats) stats.fragmentUnit = (stats.fragmentUnit || 0) + 1;
                if (stats) stats.mediaCardDirectTextFragment = (stats.mediaCardDirectTextFragment || 0) + 1;
              }
            }
          }
          if (SK.BLOCK_TAGS_SET.has(el.tagName)) structurallySkippedBlocks.add(el);
          return NodeFilter.FILTER_SKIP;
        }
        const _hasBlockDesc = SK.containsBlockDescendant(el);
        const _hasSelfContainer = !_hasBlockDesc && containsSelfCollectingContainer(el);
        if (_hasSelfContainer && stats) stats.selfContainerDescendant = (stats.selfContainerDescendant || 0) + 1;
        if (_hasBlockDesc || _hasSelfContainer) {
          if (stats) stats.hasBlockDescendant = (stats.hasBlockDescendant || 0) + 1;
          if (!fragmentExtracted.has(el)) {
            const frags = extractInlineFragments(el, { extraBoundary: _selfContainerBoundary });
            if (frags.length > 0) {
              fragmentExtracted.add(el);
              for (const f of frags) {
                pushFragment(f);
                if (stats) stats.fragmentUnit = (stats.fragmentUnit || 0) + 1;
              }
            }
          }
          if (SK.BLOCK_TAGS_SET.has(el.tagName)) structurallySkippedBlocks.add(el);
          return NodeFilter.FILTER_SKIP;
        }
        if (el.querySelector('script, style, noscript, textarea') &&
            (el.innerText || '').trim().length < 2) {
          if (stats) stats.hardExcludeInflated = (stats.hardExcludeInflated || 0) + 1;
          return NodeFilter.FILTER_REJECT;
        }
        if (!isCandidateText(el)) {
          if (stats) stats.notCandidateText = (stats.notCandidateText || 0) + 1;
          return NodeFilter.FILTER_REJECT;
        }
        if (!/^H[1-6]$/.test(el.tagName) && el.querySelectorAll('*').length > 3) {
          const _visText = (el.innerText || '').trim();
          if (_visText.length < 20) {
            if (stats) stats.shortBlockComplexSkip = (stats.shortBlockComplexSkip || 0) + 1;
            if (SK.BLOCK_TAGS_SET.has(el.tagName)) shortBlockRejectedBlocks.add(el);
            return NodeFilter.FILTER_REJECT;
          }
        }
        if (stats) stats.acceptedByWalker = (stats.acceptedByWalker || 0) + 1;
        return NodeFilter.FILTER_ACCEPT;
      },
    };
    const walker = document.createTreeWalker(scopeRoot, NodeFilter.SHOW_ELEMENT, _walkerFilter);
    let node;
    let _pendingRootNode = (_includeRootCandidate && scopeRoot.nodeType === Node.ELEMENT_NODE
      && _walkerFilter.acceptNode(scopeRoot) === NodeFilter.FILTER_ACCEPT) ? scopeRoot : null;
    while ((node = _pendingRootNode || walker.nextNode())) {
      _pendingRootNode = null;
      if ((node.textContent || '').trim().length > SK.BR_BLOCK_SPLIT_CHARS) {
        const brTarget = findBrSplitTarget(node);
        if (brTarget) {
          const splitFrags = splitBrBlock(brTarget);
          if (splitFrags.length >= 2) {
            SK.snapshotOnce?.(brTarget);
            for (const f of splitFrags) {
              pushFragment(f);
              if (stats) stats.blockBrSplit = (stats.blockBrSplit || 0) + 1;
            }
            seen.add(node);
            fragmentExtracted.add(brTarget);
            if (brTarget !== node) seen.add(brTarget);
            continue;
          }
        }
      }
      results.push({ kind: 'element', el: node });
      seen.add(node);
      fragmentExtracted.add(node);
    }

    qsaOnPath(scopeRoot, 'button').forEach(btn => {
      if (!onPath(btn)) return;
      if (seen.has(btn)) return;
      const text = (btn.textContent || '').trim();
      if (text.length < _buttonThreshold(text)) return;
      if (btn.hasAttribute('data-transit-translated')) return;
      if (!SK.isVisible(btn)) return;
      if (isInsideExcludedContainer(btn, excludedMemo)) return;
      if (!_foreignPage) {
        let _cur = btn.parentElement;
        while (_cur && _cur !== document.body) {
          if (widgetRejectedBlocks.has(_cur)) return;
          _cur = _cur.parentElement;
        }
      }
      if (!isCandidateText(btn)) return;
      const leaves = btn.querySelectorAll('span:not(:has(> :not(span)))');
      let added = false;
      for (const leaf of leaves) {
        if (seen.has(leaf)) continue;
        const lt = (leaf.textContent || '').trim();
        if (lt.length < 2) continue;
        if (!SK.isVisible(leaf)) continue;
        if (isInsideExcludedContainer(leaf, excludedMemo)) continue;
        results.push({ kind: 'element', el: leaf });
        seen.add(leaf);
        leaf.querySelectorAll('span').forEach(s => seen.add(s));
        added = true;
        if (stats) stats.longTextButtonLeaf = (stats.longTextButtonLeaf || 0) + 1;
      }
      if (!added) {
        if (!_hasVisibleText(btn)) {
          if (stats) stats.buttonNoVisibleText = (stats.buttonNoVisibleText || 0) + 1;
          return;
        }
        results.push({ kind: 'element', el: btn });
        seen.add(btn);
        if (stats) stats.longTextButtonDirect = (stats.longTextButtonDirect || 0) + 1;
      }
    });

    for (const block of shortBlockRejectedBlocks) {
      qsaOnPath(block, 'span:not(:has(*)), a:not(:has(*))').forEach(leaf => {
        if (!onPath(leaf)) return;
        if (seen.has(leaf)) return;
        const txt = (leaf.textContent || '').trim();
        const _sbThreshold = _CJK_RE.test(txt) ? 4 : 8;
        if (txt.length < _sbThreshold) return;
        if (!SK.isVisible(leaf)) return;
        if (!isCandidateText(leaf)) return;
        if (isInsideExcludedContainer(leaf, excludedMemo)) return;
        results.push({ kind: 'element', el: leaf });
        seen.add(leaf);
        if (stats) stats.shortBlockLeaf = (stats.shortBlockLeaf || 0) + 1;
      });
    }

    qsaOnPath(scopeRoot, SK.INCLUDE_BY_SELECTOR).forEach(el => {
      if (!onPath(el)) return;
      if (seen.has(el)) return;
      if (el.hasAttribute('data-transit-translated')) return;
      if (fragmentExtracted.has(el)) return;
      if (isInsideExcludedContainer(el, excludedMemo)) return;
      if (isInteractiveWidgetContainer(el)) return;
      if (!SK.isVisible(el)) return;
      if (!isCandidateText(el)) return;

      if (!fragmentExtracted.has(el)) {
        const selfCs = SK.getCS(el);
        const selfDsp = selfCs?.display;
        const isBlockDisplay = selfDsp === 'block' || selfDsp === 'flow-root' ||
                               selfDsp === 'flex' || selfDsp === 'grid' ||
                               selfDsp === 'list-item';
        if (isBlockDisplay) {
          const directChildren = Array.from(el.children);
          const allLeafSpan = directChildren.length >= 2 && directChildren.every(c =>
            c.tagName === 'SPAN' &&
            c.children.length === 0 &&
            (c.textContent || '').trim().length >= 2
          );
          if (allLeafSpan) {
            if (stats) stats.includeSelectorLeafSplit = (stats.includeSelectorLeafSplit || 0) + 1;
            fragmentExtracted.add(el);
            widgetRejectedBlocks.add(el);
            for (const leaf of directChildren) {
              if (seen.has(leaf)) continue;
              if (leaf.hasAttribute('data-transit-translated')) continue;
              if (!SK.isVisible(leaf)) continue;
              if (!isCandidateText(leaf)) continue;
              if (isInsideExcludedContainer(leaf, excludedMemo)) continue;
              results.push({ kind: 'element', el: leaf });
              seen.add(leaf);
            }
            return;
          }
        }
      }

      if (stats) stats.includedBySelector = (stats.includedBySelector || 0) + 1;
      results.push({ kind: 'element', el });
      seen.add(el);
    });

    qsaOnPath(scopeRoot, INLINE_PROSE_WRAPPER_SELECTOR).forEach(el => {
      if (!onPath(el)) return;
      if (seen.has(el)) return;
      if (el.hasAttribute('data-transit-translated')) return;
      if (hasBlockAncestor(el)) return;
      if (hasAncestorExtracted(el, fragmentExtracted)) return;
      if (SK.containsBlockDescendant(el)) return;
      if (isInsideExcludedContainer(el, excludedMemo)) return;
      if (isInteractiveWidgetContainer(el)) return;
      if (!SK.isVisible(el)) return;
      if (!isCandidateText(el)) return;
      if (directTextLength(el) < (_foreignPage ? 2 : 20)) return;
      results.push({ kind: 'element', el });
      seen.add(el);
      fragmentExtracted.add(el);
      el.querySelectorAll('*').forEach(c => seen.add(c));
      if (stats) stats.inlineProseWrapper = (stats.inlineProseWrapper || 0) + 1;
    });

    qsaOnPath(scopeRoot, 'a').forEach(a => {
      if (!(a instanceof HTMLElement)) return;
      if (!onPath(a)) return;
      if (seen.has(a)) return;
      if (a.hasAttribute('data-transit-translated')) return;
      if (hasBlockAncestor(a)) return;
      if (SK.containsBlockDescendant(a)) return;
      if (a.querySelector(SK.CONTAINER_TAG_SELECTOR)) {
        if (!_foreignPage) return;
        const _ct = (a.textContent || '').trim();
        if (_ct.length >= 20 || _ct.length < 2) return;
      }
      if (isInsideExcludedContainer(a, excludedMemo)) return;
      if (isInteractiveWidgetContainer(a)) return;
      if (!SK.isVisible(a)) return;
      if (!isCandidateText(a)) return;
      const txt = (a.textContent || '').trim();
      if (txt.length < 20) {
        if (!_foreignPage || txt.length < 2) return;
        let _inWidget = false;
        { let _cur = a.parentElement;
          while (_cur && _cur !== document.body) {
            if (widgetRejectedBlocks.has(_cur)) { _inWidget = true; break; }
            _cur = _cur.parentElement;
          }
        }
        if (_inWidget) {
          if (!_foreignPage) return;
          const _aRole = a.getAttribute('role');
          const _aHref = a.getAttribute('href');
          if (_aRole === 'button' && (!_aHref || _aHref === '#' || _aHref.startsWith('javascript:'))) return;
          { let _cur2 = a.parentElement;
            while (_cur2 && _cur2 !== document.body) {
              if (widgetRejectedBlocks.has(_cur2) && fragmentExtracted.has(_cur2)) return;
              _cur2 = _cur2.parentElement;
            }
          }
        }
      }
      if (stats) stats.leafContentAnchor = (stats.leafContentAnchor || 0) + 1;
      results.push({ kind: 'element', el: a });
      seen.add(a);
    });

    qsaOnPath(scopeRoot, 'div:not(:has(*)), span:not(:has(*))').forEach(d => {
      if (!onPath(d)) return;
      if (seen.has(d)) return;
      if (fragmentExtracted.has(d)) return;
      if (d.hasAttribute('data-transit-translated')) return;
      if (hasBlockAncestor(d)) return;
      if (isInsideExcludedContainer(d, excludedMemo)) return;
      if (isInteractiveWidgetContainer(d)) return;
      if (!SK.isVisible(d)) return;
      if (!isCandidateText(d)) return;
      const txt = (d.textContent || '').trim();
      if (txt.length < 2) return;
      if (txt.length < 20) {
        if (_foreignPage && txt.length >= 2) {
          let _cur = d.parentElement;
          while (_cur && _cur !== document.body) {
            if (widgetRejectedBlocks.has(_cur)) {
              if ((_cur.innerText || '').trim().length < 50) return;
              break;
            }
            _cur = _cur.parentElement;
          }
        } else {
          const cs = SK.getCS(d);
          const fs = parseFloat(cs?.fontSize) || 0;
          const disp = cs.display;
          const isBlockDisplay = disp === 'block' || disp === 'flex' ||
                                 disp === 'grid' || disp === 'list-item';
          if (!(isBlockDisplay && fs >= 24)) return;
        }
      }
      if (stats) stats.leafContentDiv = (stats.leafContentDiv || 0) + 1;
      results.push({ kind: 'element', el: d });
      seen.add(d);
    });

    const gridExcludedMemo = new Map();
    qsaOnPath(scopeRoot, 'table[role="grid"] td').forEach(td => {
      if (!onPath(td)) return;
      const tdText = (td.textContent || '').trim();
      if (tdText.length < 20) return;
      if (td.hasAttribute('data-transit-translated')) return;

      qsaOnPath(td, '*').forEach(el => {
        if (!onPath(el)) return;
        if (seen.has(el)) return;
        if (el.hasAttribute('data-transit-translated')) return;
        if (isInsideExcludedContainer(el, gridExcludedMemo, td.parentElement)) return;

        for (const child of el.children) {
          if ((child.textContent || '').trim().length >= 15) return;
        }

        const text = (el.textContent || '').trim();
        if (text.length < 15) return;

        if (!SK.isVisible(el)) return;
        if (!isCandidateText(el)) return;

        if (stats) stats.gridCellLeaf = (stats.gridCellLeaf || 0) + 1;
        results.push({ kind: 'element', el });
        seen.add(el);
      });
    });
    }

    processScope(root, includeRoot);

    for (const sr of _getShadowRoots()) {
      if (stats) stats.shadowRootsScanned = (stats.shadowRootsScanned || 0) + 1;
      processScope(sr);
    }

    return results;
  };

  SK.consolidateDualInlineUnits = function consolidateDualInlineUnits(units) {
    if (!units || units.length === 0) return units;
    const win = document.defaultView;
    if (!win) return units;

    const groups = new Map();
    const unitBlockAnc = new Array(units.length);
    const unitElSet = new Set();
    for (let i = 0; i < units.length; i++) {
      if (units[i].el) unitElSet.add(units[i].el);
    }

    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.kind !== 'element' || !u.el || !u.el.isConnected) continue;
      const cs = win.getComputedStyle(u.el);
      const dsp = cs?.display || '';
      if (!dsp.startsWith('inline')) continue;
      const anc = SK.findBlockAncestor?.(u.el);
      if (!anc || anc === document.body) continue;
      if (unitElSet.has(anc)) continue;
      unitBlockAnc[i] = anc;
      if (!groups.has(anc)) groups.set(anc, []);
      groups.get(anc).push(i);
    }

    const toRemove = new Set();
    const replacementByIndex = new Map();
    for (const [anc, indices] of groups) {
      if (indices.length < 2) continue;
      for (const idx of indices) toRemove.add(idx);
      replacementByIndex.set(indices[0], { kind: 'element', el: anc });
    }
    if (toRemove.size === 0) return units;

    const result = [];
    for (let i = 0; i < units.length; i++) {
      if (toRemove.has(i)) {
        const rep = replacementByIndex.get(i);
        if (rep) result.push(rep);
        continue;
      }
      result.push(units[i]);
    }
    SK.sendLog?.('info', 'detect', 'consolidateDualInlineUnits', {
      before: units.length, after: result.length, merged: toRemove.size,
    });
    return result;
  };

  SK.findOpenShadowRoots = function findOpenShadowRoots(root) {
    if (!root) return [];
    const found = [];
    function walk(node) {
      if (!node || node.nodeType !== 1) return;
      if (node.shadowRoot && node.shadowRoot.mode === 'open') {
        found.push(node.shadowRoot);
        let inner = node.shadowRoot.firstElementChild;
        while (inner) { walk(inner); inner = inner.nextElementSibling; }
      }
      let c = node.firstElementChild;
      while (c) { walk(c); c = c.nextElementSibling; }
    }
    if (root.nodeType === 1) {
      walk(root);
    } else if (root.firstElementChild) {
      let c = root.firstElementChild;
      while (c) { walk(c); c = c.nextElementSibling; }
    }
    return found;
  };

  SK.extractGlossaryInput = function extractGlossaryInput(units) {
    const parts = [];
    const title = document.title?.trim();
    if (title) parts.push(title);

    for (const unit of units) {
      const el = unit.el;
      if (!el) continue;
      const tag = el.tagName;

      if (/^H[1-6]$/.test(tag)) {
        const txt = el.innerText?.trim();
        if (txt) parts.push(txt);
        continue;
      }

      if (tag === 'FIGCAPTION' || tag === 'CAPTION') {
        const txt = el.innerText?.trim();
        if (txt) parts.push(txt);
        continue;
      }

      const fullText = el.innerText?.trim();
      if (!fullText) continue;
      const sentenceMatch = fullText.match(/^[^.!?。！？]*[.!?。！？]/);
      const firstSentence = sentenceMatch ? sentenceMatch[0] : fullText.slice(0, 200);
      if (firstSentence.length >= 10) {
        parts.push(firstSentence);
      }
    }

    return parts.join('\n');
  };

  function readabilityScore(el) {
    if (!el) return 0;
    let score = 0;
    const text = el.textContent || '';
    score += text.length / 100;
    score += (text.match(/[,,]/g) || []).length;
    if (/^H[1-3]$/.test(el.tagName)) score += 5;
    if (el.querySelector && el.querySelector('p')) score += 3;
    return score;
  }

  function computeViewportDistance(unit) {
    const el = unit.el;
    if (!el || typeof el.getBoundingClientRect !== 'function') return Infinity;
    let rect;
    try { rect = el.getBoundingClientRect(); } catch (_) { return Infinity; }
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
    if (rect.bottom >= 0 && rect.top <= vh) return 0;
    const elCenter = (rect.top + rect.bottom) / 2;
    const viewportCenter = vh / 2;
    return Math.abs(elCenter - viewportCenter);
  }

  SK.prioritizeUnits = function prioritizeUnits(units) {
    const tierCache = new Map();
    const viewportCache = new Map();

    function computeTier(unit) {
      const el = unit.el;
      if (!el || !el.parentElement) return 3;

      let cur = el.parentElement;
      let inMainOrArticle = false;
      while (cur && cur !== document.body) {
        const tag = cur.tagName;
        if (tag === 'MAIN' || tag === 'ARTICLE') { inMainOrArticle = true; break; }
        const role = cur.getAttribute && cur.getAttribute('role');
        if (role === 'main' || role === 'article') { inMainOrArticle = true; break; }
        cur = cur.parentElement;
      }

      if (inMainOrArticle) {
        return readabilityScore(el) >= 1 ? 0 : 1;
      }

      const text = (el.textContent || '').trim();
      if (text.length < 80) return 3;
      let linkChars = 0;
      const anchors = el.querySelectorAll ? el.querySelectorAll('a') : [];
      for (const a of anchors) linkChars += (a.textContent || '').length;
      if (text.length > 0 && linkChars / text.length >= 0.5) return 3;
      return 2;
    }

    for (const u of units) {
      tierCache.set(u, computeTier(u));
      viewportCache.set(u, computeViewportDistance(u));
    }
    return units.slice().sort((a, b) => {
      const tierDiff = tierCache.get(a) - tierCache.get(b);
      if (tierDiff !== 0) return tierDiff;
      return viewportCache.get(a) - viewportCache.get(b);
    });
  };

})(window.__SK);
