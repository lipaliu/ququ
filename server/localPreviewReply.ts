import { relevantHistory } from "./conversationContext";
type PreviewHistoryMessage = { role: "user" | "assistant"; content: string };

function userContext(input: string, history: PreviewHistoryMessage[]) {
  return [...relevantHistory(input, history).filter((message) => message.role === "user").map((message) => message.content), input].join("\n");
}

export function buildLocalPreviewReply(input: string, history: PreviewHistoryMessage[] = []) {
  const fullContext = userContext(input, history);
  const hasLivestreamCareer = /直播|主播|带货|直播间|账号|粉丝/.test(fullContext);
  const hasSponsorMoney = /大哥|转账|给我.{0,4}(钱|米)|零花钱|包养|供养|每个?月.{0,12}(万|千|百)/.test(fullContext);
  const hasRelocationControl = /搬.{0,12}(他的?城市|他那|那边)|去他.{0,8}(城市|那边)|租.{0,6}房|异地/.test(fullContext);
  const hasWorkRestriction = /不让.{0,8}(我)?直播|不许.{0,8}(我)?直播|别.{0,4}直播|停止直播|停播|不让我工作|不许我工作/.test(fullContext);
  const hasMarriedPartner = /有老婆|老婆孩子|已婚|原配|有家庭/.test(fullContext);
  const isEconomicControlScenario = hasLivestreamCareer
    && hasSponsorMoney
    && hasWorkRestriction
    && (hasRelocationControl || hasMarriedPartner);
  const contextAlreadyHasGift = /礼物|送了|送我|买了|赫莲娜|补偿|弥补/.test(fullContext);
  const isGiftDecisionFollowup = /收不收|退不退|礼物.{0,8}(收|退)|(收|退).{0,8}礼物/.test(input)
    || (contextAlreadyHasGift && /(?:收了|收下|拿了).{0,16}(?:必须|就得|要|复合|和好|结婚|陪他|发生关系)/.test(input));
  const hasChildfreeConflict = /不生|不要孩子|不想生|生育|丁克/.test(fullContext);
  const hasCareBurden = /伺候|照顾|照料|照护|换药|护理|老妈子/.test(fullContext);
  const hasGiftRepair = contextAlreadyHasGift;
  const hasBreakup = /分手|分了|前任/.test(fullContext);
  const giftHasExplicitCondition = /(?:收了|收下|拿了).{0,16}(?:必须|就得|要|复合|和好|结婚|陪他|发生关系)|(?:复合|和好|结婚).{0,16}(?:才送|才给)|附带条件|有条件|借给|借款|贷款|代持/.test(fullContext);
  const mentionsFiveYears = /[五5]年/.test(fullContext);
  const hasSunkCost = /[五5]年|多年|舍不得|分手|复合|继续这段关系|找不到更好/.test(fullContext);
  const hasResourceEntanglement = /北京|上海|深圳|户口|城市|工作|买房|全家|家里|合租/.test(fullContext);

  if (isEconomicControlScenario) {
    const locationLine = hasRelocationControl
      ? "你自己的常住地和生活盘不要撤，也不要把长期住房、行踪和日常开销全部交给他控制。去见他是一件事，把整个人搬进他安排的生活里是另一件事。"
      : "你自己的生活盘、社交圈和收入来源都要保留，不能只剩他一个入口。";
    const availabilityLine = hasMarriedPartner
      ? "而且他有自己的家庭，你本来就不掌握他的时间、关系安排和长期兑现，所以更不能把唯一收入和生活盘也交给他。"
      : "你并不掌握他以后是否持续给，所以不能把唯一收入和生活盘交给他。";
    return `钱可以收，直播不要停，自己的生活盘也不要撤。这里说的能收，是对方没有把停工、迁城作为交换条件的支持。有这种条件，就不能只看钱有多少，要看你因此交出什么。\n\n直播的价值不只在当下收入。账号、粉丝、表达能力和行业关系，都有机会逐渐积累在你身上。可对方提供的支持，是由他决定是否继续的可撤销现金流。你不能拿别人随时能关掉的一根水管，去换掉自己原来那口井。\n\n一旦收入和住所都依赖同一个人，他的决定就会影响你的工作、社交、住在哪里，以及你什么时候可以离开。${availabilityLine}\n\n所以直播不要停，也不要因为眼前的投入就默认自己必须照他的安排生活。愿意接受哪些支持，要和愿意承担哪些条件一起判断；如果必须放弃事业才能得到这笔钱，那就不能把它当成没有代价的收益。${locationLine}\n\n没有附加义务的钱为什么不拿？但收下支持和交出事业，这两件事不交换。先把停播和居住条件说清楚，再决定这笔支持是否适合接受。保留自己能赚钱、能选择住处、也能退出的能力，才不会让对方的一次决定左右你全部生活。`;
  }

  if (isGiftDecisionFollowup) {
    if (giftHasExplicitCondition) {
      return "先不收，退回去。因为这次不是单纯送礼，是他把礼物和你必须复合、结婚或承担别的义务绑在了一起。那就不是回补，是拿四千块买你的选择权。这个交换你不接受，就不要拿。";
    }
    const unresolved = [
      hasChildfreeConflict ? "不生育这个长期底线" : null,
      hasCareBurden ? "照护责任和边界" : null,
      hasResourceEntanglement ? "城市、工作和家庭安排" : null,
    ].filter((item): item is string => Boolean(item));
    const relationshipPosition = hasBreakup ? "你们现在已经分手" : "你们的关系还没有谈清楚";
    const priorValue = hasCareBurden
      ? "你前面给他换药、照顾他，这些付出已经发生了。四千块钱的东西，最多算他对过去关系的一点回补，你为什么替他省？"
      : "他愿意给出的这点价值，你没有必要先替他往回收。";
    const cannotBuy = [
      hasChildfreeConflict ? "你不生育的底线" : null,
      hasResourceEntanglement ? "你的城市和家庭资源" : null,
      "复合资格",
    ].filter((item): item is string => Boolean(item)).join("、");
    return `先收着，不退。\n\n${priorValue}但你听清楚：收礼物和复合是两笔账。${relationshipPosition}，${unresolved.length ? `${unresolved.join("、")}一个都没解决` : "真正的问题没有解决"}。他买的是一套礼物，不是用四千块买走${cannotBuy}。\n\n所以礼物拿着，关系不恢复。不要自己替他把礼物升级成解决方案。他如果真想复合，就回到那些没解决的问题上拿行动；问题没解决，你还是不能复合。就这么简单。`;
  }

  if (!hasBreakup && !hasChildfreeConflict && !/复合|继续这段关系|还要不要继续/.test(fullContext)) {
    return "这条问题暂时没有生成出有效回答，请重新发送这一条。";
  }

  const opening = hasChildfreeConflict && hasCareBurden
    ? "我先下结论：现在不要复合。不是让你因为他生病就把人判死刑，是他把自己的治疗责任直接变成了你的义务；再加上不生育这件事，你们卡的是两个长期结构问题。"
    : hasChildfreeConflict
      ? "我先下结论：现在别急着复合。你们卡的不是一次吵架，是生育和婚姻安排没有真正对齐。"
      : "我先下结论：现在别被一次示好拉回去。关键不是他这一刻态度好不好，是原来反复发生的问题有没有新的解决方案。";

  const sunkCost = hasSunkCost
    ? `${mentionsFiveYears ? "五年" : "过去这些年"}已经花掉了，它只能说明你投入过，不能证明未来还值得继续投。你说分了未必找到更好的，这也是拿一个未知的人，替眼前已经确定的问题找补。你不需要先找到更好的，才有资格结束不合适的。`
    : "过去的投入已经发生了，判断下一步只看未来，不拿过去替现在找补。";

  const actions = [
    hasCareBurden ? "先把照护停下来。他的治疗、换药和请人，回到他自己和他家人的责任里。" : "先暂停伴侣式投入，把自己的时间和选择权收回来。",
    hasChildfreeConflict
      ? `只谈一个硬条件：他本人是否真正接受你长期不生，并且愿意向家里明确承担这个选择${hasResourceEntanglement ? "；留在哪座城市、工作和住房怎么安排，也不能默认由你托底" : ""}。`
      : "只谈一个核心问题，让他给明确答案和下一步动作。",
    hasGiftRepair ? "礼物先不算改变。能花一次钱，不等于能持续承担、尊重边界、解决长期矛盾。" : "以后只看连续行为，不看临时情绪和口头承诺。",
  ];

  return `${opening}\n\n${sunkCost}\n\n你现在做三件事：\n1. ${actions[0]}\n2. ${actions[1]}\n3. ${actions[2]}\n\n复合的门槛不是他舍不得你，也不是送了什么，而是这些条件有没有出现可验证的新答案。没有，就维持分手。`;
}
