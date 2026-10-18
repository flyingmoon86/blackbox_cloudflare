// Generated from src/client/announcement-editor.js by npm run assets:build. Do not edit this output.
"use strict";
(() => {
  // node_modules/marked/lib/marked.esm.js
  function B() {
    return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
  }
  var y = B();
  function V(a3) {
    y = a3;
  }
  var M = { exec: () => null };
  function D(a3) {
    let e = [];
    return (t) => {
      let n = Math.max(0, Math.min(3, t - 1)), i = e[n];
      return i || (i = a3(n), e[n] = i), i;
    };
  }
  function h(a3, e = "") {
    let t = typeof a3 == "string" ? a3 : a3.source, n = { replace: (i, r) => {
      let o = typeof r == "string" ? r : r.source;
      return o = o.replace(x.caret, "$1"), t = t.replace(i, o), n;
    }, getRegex: () => new RegExp(t, e) };
    return n;
  }
  var ze = ((a3 = "") => {
    try {
      return !!new RegExp("(?<=1)(?<!1)" + a3);
    } catch {
      return false;
    }
  })();
  var x = { codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, endingSpaceTabChar: /[ \t]$/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, leadingSpaceTab: /^[ \t]+/, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/, numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (a3) => new RegExp(`^( {0,3}${a3})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: D((a3) => new RegExp(`^ {0,${a3}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: D((a3) => new RegExp(`^ {0,${a3}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)), fencesBeginRegex: D((a3) => new RegExp(`^ {0,${a3}}(?:\`\`\`|~~~)`)), headingBeginRegex: D((a3) => new RegExp(`^ {0,${a3}}#`)), htmlBeginRegex: D((a3) => new RegExp(`^ {0,${a3}}(?:</?(?:${Q})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, "i")), blockquoteBeginRegex: D((a3) => new RegExp(`^ {0,${a3}}>`)) };
  var Ee = /^(?:[ \t]*(?:\n|$))+/;
  var Me = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
  var Ce = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
  var N = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
  var Ie = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
  var Y = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
  var fe = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
  var me = h(fe).replace(/bull/g, Y).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
  var Be = h(fe).replace(/bull/g, Y).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
  var ee = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
  var De = /^[^\n]+/;
  var te = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
  var qe = h(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", te).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
  var Ze = h(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, Y).getRegex();
  var Q = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
  var ne = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
  var ve = h("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", ne).replace("tag", Q).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
  var xe = (a3) => h(ee).replace("hr", N).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", a3).replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Q).getRegex();
  var He = xe(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
  var Ge = xe(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
  var Ne = h(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", Ge).getRegex();
  var re = { blockquote: Ne, code: Me, def: qe, fences: Ce, heading: Ie, hr: N, html: ve, lheading: me, list: Ze, newline: Ee, paragraph: He, table: M, text: De };
  var de = h("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", N).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Q).getRegex();
  var Qe = { ...re, lheading: Be, table: de, paragraph: h(ee).replace("hr", N).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", de).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", " {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", Q).getRegex() };
  var je = { ...re, html: h(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", ne).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: M, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: h(ee).replace("hr", N).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", me).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
  var Fe = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
  var Ue = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
  var be = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
  var Ke = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
  var S = /[\p{P}\p{S}]/u;
  var q = /[\s\p{P}\p{S}]/u;
  var j = /[^\s\p{P}\p{S}]/u;
  var Xe = h(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, q).getRegex();
  var We = /[\p{Pi}\p{Ps}"']/u;
  var Re = /(?!~)[\p{P}\p{S}]/u;
  var Ve = /(?!~)[\s\p{P}\p{S}]/u;
  var Je = /(?:[^\s\p{P}\p{S}]|~)/u;
  var Ye = h(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", ze ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
  var Te = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
  var et = h(Te, "u").replace(/punct/g, S).getRegex();
  var tt = h(Te, "u").replace(/punct/g, Re).getRegex();
  var nt = /^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/;
  var rt = h(nt, "u").replace(/openQuote/g, We).replace(/punct/g, S).getRegex();
  var Oe = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
  var st = h(Oe, "gu").replace(/notPunctSpace/g, j).replace(/punctSpace/g, q).replace(/punct/g, S).getRegex();
  var it = h(Oe, "gu").replace(/notPunctSpace/g, Je).replace(/punctSpace/g, Ve).replace(/punct/g, Re).getRegex();
  var ot = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)";
  var at = h(ot, "gu").replace(/notPunctSpace/g, j).replace(/punctSpace/g, q).replace(/punct/g, S).getRegex();
  var lt = h("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, j).replace(/punctSpace/g, q).replace(/punct/g, S).getRegex();
  var ut = "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)";
  var pt = h(ut, "gu").replace(/notPunctSpace/g, j).replace(/punctSpace/g, q).replace(/punct/g, S).getRegex();
  var ct = h(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, S).getRegex();
  var ht = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
  var dt = h(ht, "gu").replace(/notPunctSpace/g, j).replace(/punctSpace/g, q).replace(/punct/g, S).getRegex();
  var kt = h(/\\(punct)/, "gu").replace(/punct/g, S).getRegex();
  var gt = h(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, "gu").replace(/punct/g, S).getRegex();
  var ft = h(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
  var mt = h(ne).replace("(?:-->|$)", "-->").getRegex();
  var xt = h("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", mt).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
  var we = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
  var K = h(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets", we).getRegex();
  var bt = h(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/).replace("label", K).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
  var Rt = h(/^!?\[(label)\]\[(ref)\]/).replace("label", K).replace("ref", te).getRegex();
  var Tt = h(/^!?\[(ref)\](?:\[\])?/).replace("ref", te).getRegex();
  var ke = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
  var Ot = h(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets", we).getRegex();
  var wt = h("reflink|nolink(?!\\()", "g").replace("reflink", h(/^!?\[(label)\]\[(ref)\]/).replace("label", Ot).replace("ref", ke).getRegex()).replace("nolink", h(/^!?\[(ref)\](?:\[\])?/).replace("ref", ke).getRegex()).getRegex();
  var ge = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
  var Pt = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
  var yt = h(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, Pt).getRegex();
  var se = { _backpedal: M, anyPunctuation: kt, anyPunctuationOutsideCode: gt, autolink: ft, blockSkip: Ye, br: be, code: Ue, del: M, delLDelim: M, delRDelim: M, emStrongLDelim: et, emStrongRDelimAst: st, emStrongRDelimUnd: lt, escape: Fe, link: bt, nolink: Tt, punctuation: Xe, reflink: Rt, reflinkSearch: wt, tag: xt, text: Ke, url: M };
  var St = { ...se, emStrongLDelim: rt, emStrongRDelimAst: at, emStrongRDelimUnd: pt, link: h(/^!?\[(label)\]\((.*?)\)/).replace("label", K).getRegex(), reflink: h(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", K).getRegex() };
  var J = { ...se, emStrongRDelimAst: it, emStrongLDelim: tt, delLDelim: ct, delRDelim: dt, url: h(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("emailProtocol", yt).replace("protocol", ge).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: h(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace("protocol", ge).replace(/emailProtocol/g, /(?:mailto|xmpp):/).getRegex() };
  var _t = { ...J, br: h(be).replace("{2,}", "*").getRegex(), text: h(J.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
  var F = { normal: re, gfm: Qe, pedantic: je };
  var Z = { normal: se, gfm: J, breaks: _t, pedantic: St };
  var $t = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  var Pe = (a3) => $t[a3];
  function w(a3, e) {
    if (e) {
      if (x.escapeTest.test(a3)) return a3.replace(x.escapeReplace, Pe);
    } else if (x.escapeTestNoEncode.test(a3)) return a3.replace(x.escapeReplaceNoEncode, Pe);
    return a3;
  }
  function ye(a3) {
    return x.numericCharacterReference.test(a3) ? a3.replace(x.numericCharacterReferenceOrAmpersand, (e, t, n) => {
      if (t === void 0 && n === void 0) return "&amp;";
      let i = t === void 0 ? Number.parseInt(n, 16) : Number.parseInt(t, 10);
      return i === 0 || i > 1114111 || i >= 55296 && i <= 57343 ? "\uFFFD" : i === 38 ? "&amp;" : String.fromCodePoint(i);
    }) : a3;
  }
  function ie(a3) {
    try {
      a3 = encodeURI(a3).replace(x.percentDecode, "%");
    } catch {
      return null;
    }
    return a3;
  }
  function oe(a3, e) {
    let t = a3.replace(x.findPipe, (r, o, s) => {
      let l = false, u = o;
      for (; --u >= 0 && s[u] === "\\"; ) l = !l;
      return l ? "|" : " |";
    }), n = t.split(x.splitPipe), i = 0;
    if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
    else for (; n.length < e; ) n.push("");
    for (; i < n.length; i++) n[i] = n[i].trim().replace(x.slashPipe, "|");
    return n;
  }
  function A(a3, e, t) {
    let n = a3.length;
    if (n === 0) return "";
    let i = 0;
    for (; i < n; ) {
      let r = a3.charAt(n - i - 1);
      if (r === e && !t) i++;
      else if (r !== e && t) i++;
      else break;
    }
    return a3.slice(0, n - i);
  }
  function ae(a3) {
    let e = a3.split(`
`), t = e.length - 1;
    for (; t >= 0 && x.blankLine.test(e[t]); ) t--;
    return e.length - t <= 2 ? a3 : e.slice(0, t + 1).join(`
`);
  }
  function v(a3) {
    return a3.trim().toLowerCase().toUpperCase().toLowerCase();
  }
  function le(a3, e) {
    if (a3.indexOf(e[0]) === -1 && a3.indexOf(e[1]) === -1) return -1;
    let t = 0;
    for (let n = 0; n < a3.length; n++) if (a3[n] === "\\") n++;
    else if (a3[n] === e[0]) t++;
    else if (a3[n] === e[1] && (t--, t < 0)) return n;
    return t > 0 ? -2 : -1;
  }
  function X(a3, e = 0) {
    let t = e, n = "";
    for (let i of a3) if (i === "	") {
      let r = 4 - t % 4;
      n += " ".repeat(r), t += r;
    } else n += i, t++;
    return n;
  }
  function Se(a3, e, t, n, i) {
    let r = e.href, o = e.title || null, s = a3[1].replace(i.other.outputLinkReplace, "$1"), l = a3[0].charAt(0) === "!", u = n.state.inLink, c = n.state.linkEmitted, p = n.state.inRawBlock;
    n.state.inLink = true, n.state.linkEmitted = false;
    let d = n.inlineTokens(s), g = n.state.linkEmitted;
    if (n.state.linkEmitted = c, n.state.inLink = u, !l) {
      if (g) {
        n.state.inRawBlock = p;
        return;
      }
      n.state.linkEmitted = true;
    }
    return { type: l ? "image" : "link", raw: t, href: r, title: o, text: s, tokens: d };
  }
  function Lt(a3, e, t) {
    let n = a3.match(t.other.indentCodeCompensation);
    if (n === null) return e;
    let i = n[1];
    return e.split(`
`).map((r) => {
      let o = r.match(t.other.beginningSpace);
      if (o === null) return r;
      let [s] = o;
      return r.slice(Math.min(s.length, i.length));
    }).join(`
`);
  }
  function _e(a3, e, t, n) {
    if (!e.includes("<")) return false;
    for (let i = 0; i < e.length; i++) {
      if (e[i] === "\\") {
        i++;
        continue;
      }
      if (e[i] === "`") {
        let s = n.inline.code.exec(e.slice(i));
        if (s) {
          i += s[0].length - 1;
          continue;
        }
      }
      if (e[i] !== "<") continue;
      let r = a3.slice(t + i), o = n.inline.tag.exec(r) || n.inline.autolink.exec(r);
      if (o) {
        if (o[0].length > e.length - i) return true;
        i += o[0].length - 1;
      }
    }
    return false;
  }
  var _ = class {
    options;
    rules;
    lexer;
    constructor(e) {
      this.options = e || y;
    }
    space(e) {
      let t = this.rules.block.newline.exec(e);
      if (t && t[0].length > 0) return { type: "space", raw: t[0] };
    }
    code(e) {
      let t = this.rules.block.code.exec(e);
      if (t) {
        let n = this.options.pedantic ? t[0] : ae(t[0]), i = n.replace(this.rules.other.codeRemoveIndent, "");
        return { type: "code", raw: n, codeBlockStyle: "indented", text: i };
      }
    }
    fences(e) {
      let t = this.rules.block.fences.exec(e);
      if (t) {
        let n = t[0], i = Lt(n, t[3] || "", this.rules);
        return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: i };
      }
    }
    heading(e) {
      let t = this.rules.block.heading.exec(e);
      if (t) {
        let n = t[2].trim();
        if (this.rules.other.endingHash.test(n)) {
          let i = A(n, "#");
          (this.options.pedantic || !i || this.rules.other.endingSpaceTabChar.test(i)) && (n = i.trim());
        }
        return { type: "heading", raw: A(t[0], `
`), depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
      }
    }
    hr(e) {
      let t = this.rules.block.hr.exec(e);
      if (t) return { type: "hr", raw: A(t[0], `
`) };
    }
    blockquote(e) {
      let t = this.rules.block.blockquote.exec(e);
      if (t) {
        let n = A(t[0], `
`).split(`
`), i = "", r = "", o = [];
        for (; n.length > 0; ) {
          let s = false, l = [], u;
          for (u = 0; u < n.length; u++) if (this.rules.other.blockquoteStart.test(n[u])) l.push(n[u]), s = true;
          else if (!s) l.push(n[u]);
          else break;
          n = n.slice(u);
          let c = l.join(`
`), p = c.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
          i = i ? `${i}
${c}` : c, r = r ? `${r}
${p}` : p;
          let d = this.lexer.state.top;
          if (this.lexer.state.top = true, this.lexer.blockTokens(p, o, true), this.lexer.state.top = d, n.length === 0) break;
          let g = o.at(-1);
          if (g?.type === "code" || g?.type === "heading" || g?.type === "hr" || g?.type === "html") break;
          if (g?.type === "blockquote") {
            let k = g, P = n.join(`
`), R = k.raw + `
` + P.replace(this.rules.other.blockquoteSetextReplace2, ""), m = this.blockquote(R);
            o[o.length - 1] = m;
            let E = R.substring(m.raw.length).replace(/^\n/, ""), b = E ? E.split(`
`).length : 0, H = b ? n.slice(0, -b) : n;
            H.length > 0 && (i = `${i}
${H.join(`
`)}`), r = r.substring(0, r.length - k.text.length) + m.text;
            break;
          } else if (g?.type === "list") {
            let k = g, P = k.raw + `
` + n.join(`
`), R = this.list(P);
            o[o.length - 1] = R, i = i.substring(0, i.length - g.raw.length) + R.raw, r = r.substring(0, r.length - k.raw.length) + R.raw, n = P.substring(o.at(-1).raw.length).split(`
`);
            continue;
          }
        }
        return { type: "blockquote", raw: i, tokens: o, text: r };
      }
    }
    list(e) {
      let t = this.rules.block.list.exec(e);
      if (t) {
        let n = e, i = () => n.length - e.length, r = t[1].trim(), o = r.length > 1, s = { type: "list", raw: "", ordered: o, start: o ? +r.slice(0, -1) : "", loose: false, items: [] };
        r = o ? `\\d{1,9}\\${r.slice(-1)}` : `\\${r}`, this.options.pedantic && (r = o ? r : "[*+-]");
        let l = this.rules.other.listItemRegex(r), u = false;
        for (; e; ) {
          let p = false, d = "";
          if (!(t = l.exec(e)) || this.rules.block.hr.test(e)) break;
          let g = i();
          e = e.substring(t[0].length);
          let k = t[2].split(`
`, 1)[0], P = t[1].length, R = this.options.pedantic ? X(k, P) : k.replace(this.rules.other.leadingSpaceTab, (W) => X(W, P)), m = e.split(`
`, 1)[0], E = !R.trim(), b = 0;
          if (this.options.pedantic ? (b = 2, d = R.trimStart()) : E ? b = P + 1 : (b = R.search(this.rules.other.nonSpaceChar), b = b > 4 ? 1 : b, d = R.slice(b), b += P), E && this.rules.other.blankLine.test(m) && (e = e.substring(m.length + 1), p = true), !p) {
            let W = this.rules.other.nextBulletRegex(b), ue = this.rules.other.hrRegex(b), pe = this.rules.other.fencesBeginRegex(b), ce = this.rules.other.headingBeginRegex(b), $e = this.rules.other.htmlBeginRegex(b), Le = this.rules.other.blockquoteBeginRegex(b);
            for (; e; ) {
              let he = e.split(`
`, 1)[0], G;
              if (m = he, this.options.pedantic ? (m = m.replace(this.rules.other.listReplaceNesting, "  "), G = m) : G = m.replace(this.rules.other.leadingSpaceTab, (Ae) => X(Ae)), pe.test(m) || ce.test(m) || $e.test(m) || Le.test(m) || W.test(m) || ue.test(m)) break;
              if (G.search(this.rules.other.nonSpaceChar) >= b || !m.trim()) d += `
` + G.slice(b);
              else {
                if (E || R.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || pe.test(R) || ce.test(R) || ue.test(R)) break;
                d += `
` + m;
              }
              E = !m.trim(), e = e.substring(he.length + 1), R = G.slice(b);
            }
          }
          let H = n.slice(g, i());
          s.loose || (u ? s.loose = true : this.rules.other.doubleBlankLine.test(H) && (u = true)), s.items.push({ type: "list_item", raw: H, task: !!this.options.gfm && this.rules.other.listIsTask.test(d), loose: false, text: d, tokens: [] });
        }
        let c = s.items.at(-1);
        if (c) c.raw = c.raw.trimEnd(), c.text = c.text.trimEnd();
        else return;
        s.raw = n.slice(0, i()).trimEnd();
        for (let p of s.items) if (this.lexer.state.top = false, p.tokens = this.lexer.blockTokens(p.text, []), !s.loose) {
          let d = p.tokens.filter((k) => k.type === "space"), g = d.length > 0 && d.some((k) => this.rules.other.anyLine.test(k.raw));
          s.loose = g;
        }
        for (let p of s.items) {
          let d = p.tokens[0];
          if (p.task && (d?.type === "text" || d?.type === "paragraph")) {
            p.text = p.text.replace(this.rules.other.listReplaceTask, ""), d.raw = d.raw.replace(this.rules.other.listReplaceTask, ""), d.text = d.text.replace(this.rules.other.listReplaceTask, "");
            for (let k = this.lexer.inlineQueue.length - 1; k >= 0; k--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[k].src)) {
              this.lexer.inlineQueue[k].src = this.lexer.inlineQueue[k].src.replace(this.rules.other.listReplaceTask, "");
              break;
            }
            let g = this.rules.other.listTaskCheckbox.exec(p.raw);
            if (g) {
              let k = { type: "checkbox", raw: g[0] + " ", checked: g[0] !== "[ ]" };
              p.checked = k.checked, s.loose ? p.tokens[0] && ["paragraph", "text"].includes(p.tokens[0].type) && "tokens" in p.tokens[0] && p.tokens[0].tokens ? (p.tokens[0].raw = k.raw + p.tokens[0].raw, p.tokens[0].text = k.raw + p.tokens[0].text, p.tokens[0].tokens.unshift(k)) : p.tokens.unshift({ type: "paragraph", raw: k.raw, text: k.raw, tokens: [k] }) : p.tokens.unshift(k);
            }
          } else p.task && (p.task = false);
        }
        if (s.loose) for (let p of s.items) {
          p.loose = true;
          for (let d of p.tokens) d.type === "text" && (d.type = "paragraph");
        }
        return s;
      }
    }
    html(e) {
      let t = this.rules.block.html.exec(e);
      if (t) {
        let n = ae(t[0]);
        return { type: "html", block: true, raw: n, pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: n };
      }
    }
    def(e) {
      let t = this.rules.block.def.exec(e);
      if (t) {
        if (!this.rules.other.startAngleBracket.test(t[2]) && le(t[2], "()") !== -1) return;
        let n = v(t[1]).replace(this.rules.other.multipleSpaceGlobal, " "), i = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
        return { type: "def", tag: n, raw: A(t[0], `
`), href: i, title: r };
      }
    }
    table(e) {
      let t = this.rules.block.table.exec(e);
      if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
      let n = oe(t[1]), i = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], o = { type: "table", raw: A(t[0], `
`), header: [], align: [], rows: [] };
      if (n.length === i.length) {
        for (let s of i) this.rules.other.tableAlignRight.test(s) ? o.align.push("right") : this.rules.other.tableAlignCenter.test(s) ? o.align.push("center") : this.rules.other.tableAlignLeft.test(s) ? o.align.push("left") : o.align.push(null);
        for (let s = 0; s < n.length; s++) o.header.push({ text: n[s], tokens: this.lexer.inline(n[s]), header: true, align: o.align[s] });
        for (let s of r) o.rows.push(oe(s, o.header.length).map((l, u) => ({ text: l, tokens: this.lexer.inline(l), header: false, align: o.align[u] })));
        return o;
      }
    }
    lheading(e) {
      let t = this.rules.block.lheading.exec(e);
      if (t) {
        let n = t[1].trim();
        return { type: "heading", raw: A(t[0], `
`), depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
      }
    }
    paragraph(e) {
      let t = this.rules.block.paragraph.exec(e);
      if (t) {
        let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
        return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
      }
    }
    text(e) {
      let t = this.rules.block.text.exec(e);
      if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
    }
    escape(e) {
      let t = this.rules.inline.escape.exec(e);
      if (t) return { type: "escape", raw: t[0], text: t[1] };
    }
    tag(e) {
      let t = this.rules.inline.tag.exec(e);
      if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
    }
    link(e) {
      if (this.lexer.state.linkParenPossible === false) return;
      let t = this.rules.inline.link.exec(e);
      if (t) {
        let n = t[0].charAt(0) === "!" ? 2 : 1;
        if (!this.options.pedantic && _e(e, t[1], n, this.rules)) return;
        let i = t[2].trim();
        if (!this.options.pedantic && this.rules.other.startAngleBracket.test(i)) {
          if (!this.rules.other.endAngleBracket.test(i)) return;
          let s = A(i.slice(0, -1), "\\");
          if ((i.length - s.length) % 2 === 0) return;
        } else {
          let s = le(t[2], "()");
          if (s === -2) return;
          if (s > -1) {
            let u = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + s;
            t[2] = t[2].substring(0, s), t[0] = t[0].substring(0, u).trim(), t[3] = "";
          }
        }
        let r = t[2], o = "";
        if (this.options.pedantic) {
          let s = this.rules.other.pedanticHrefTitle.exec(r);
          s && (r = s[1], o = s[3]);
        } else o = t[3] ? t[3].slice(1, -1) : "";
        return r = r.trim(), this.rules.other.startAngleBracket.test(r) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(i) ? r = r.slice(1) : r = r.slice(1, -1)), Se(t, { href: r && r.replace(this.rules.inline.anyPunctuation, "$1"), title: o && o.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
      }
    }
    reflink(e, t) {
      let n;
      if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
        let i = n[0].charAt(0) === "!" ? 2 : 1;
        if (!this.options.pedantic && _e(e, n[1], i, this.rules)) return;
        let r = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), o = t[v(r)];
        if (!o) {
          let s = n[0].charAt(0);
          return { type: "text", raw: s, text: s };
        }
        return Se(n, o, n[0], this.lexer, this.rules);
      }
    }
    emStrong(e, t, n = "") {
      let i = this.rules.inline.emStrongLDelim.exec(e);
      if (!i || !i[1] && !i[2] && !i[3] && !i[4] || i[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
      if (!(i[1] || i[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
        let o = [...i[0]].length - 1, s, l, u = o, c = 0, p = i[0][0], d = n === p, g = p === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
        for (g.lastIndex = 0, t = t.slice(-1 * e.length + o); (i = g.exec(t)) !== null; ) {
          if (s = i[1] || i[2] || i[3] || i[4] || i[5] || i[6], !s) continue;
          if (l = [...s].length, i[3] || i[4]) {
            u += l;
            continue;
          } else if (i[5] || i[6]) {
            if (o % 3 && !((o + l) % 3)) {
              c += l;
              continue;
            }
            if (d) break;
          }
          if (u -= l, u > 0) continue;
          l = Math.min(l, l + u + c);
          let k = [...i[0]][0].length, P = e.slice(0, o + i.index + k + l);
          if (Math.min(o, l) % 2) {
            let m = P.slice(1, -1);
            return { type: "em", raw: P, text: m, tokens: this.lexer.inlineTokens(m) };
          }
          let R = P.slice(2, -2);
          return { type: "strong", raw: P, text: R, tokens: this.lexer.inlineTokens(R) };
        }
      }
    }
    codespan(e) {
      let t = this.rules.inline.code.exec(e);
      if (t) {
        let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), i = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
        return i && r && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
      }
    }
    br(e) {
      let t = this.rules.inline.br.exec(e);
      if (t) return { type: "br", raw: t[0] };
    }
    del(e, t, n = "") {
      let i = this.rules.inline.delLDelim.exec(e);
      if (!i) return;
      if (!(i[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
        let o = [...i[0]].length - 1, s, l, u = o, c = this.rules.inline.delRDelim;
        for (c.lastIndex = 0, t = t.slice(-1 * e.length + o); (i = c.exec(t)) !== null; ) {
          if (s = i[1] || i[2] || i[3] || i[4] || i[5] || i[6], !s || (l = [...s].length, l !== o)) continue;
          if (i[3] || i[4]) {
            u += l;
            continue;
          }
          if (u -= l, u > 0) continue;
          l = Math.min(l, l + u);
          let p = [...i[0]][0].length, d = e.slice(0, o + i.index + p + l), g = d.slice(o, -o);
          return { type: "del", raw: d, text: g, tokens: this.lexer.inlineTokens(g) };
        }
      }
    }
    autolink(e) {
      let t = this.rules.inline.autolink.exec(e);
      if (t) {
        let n, i;
        return t[2] === "@" ? (n = t[1], i = "mailto:" + n) : (n = t[1], i = n), { type: "link", raw: t[0], text: n, href: i, autolink: true, tokens: [{ type: "text", raw: n, text: n }] };
      }
    }
    url(e) {
      let t;
      if (t = this.rules.inline.url.exec(e)) {
        let n, i;
        if (t[2] === "@") n = t[0], i = "mailto:" + n;
        else {
          let r;
          do
            r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
          while (r !== t[0]);
          n = t[0], t[1] === "www." ? i = "http://" + t[0] : i = t[0];
        }
        return { type: "link", raw: t[0], text: n, href: i, autolink: true, tokens: [{ type: "text", raw: n, text: n }] };
      }
    }
    inlineText(e) {
      let t = this.rules.inline.text.exec(e);
      if (t) {
        let n = this.lexer.state.inRawBlock;
        return { type: "text", raw: t[0], text: n ? t[0] : ye(t[0]), escaped: n };
      }
    }
  };
  var T = class a {
    tokens;
    options;
    state;
    inlineQueue;
    tokenizer;
    constructor(e) {
      this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || y, this.options.tokenizer = this.options.tokenizer || new _(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, linkEmitted: false, linkParenPossible: true, top: true };
      let t = { other: x, block: F.normal, inline: Z.normal };
      this.options.pedantic ? (t.block = F.pedantic, t.inline = Z.pedantic) : this.options.gfm && (t.block = F.gfm, this.options.breaks ? t.inline = Z.breaks : t.inline = Z.gfm), this.tokenizer.rules = t;
    }
    static get rules() {
      return { block: F, inline: Z };
    }
    static lex(e, t) {
      return new a(t).lex(e);
    }
    static lexInline(e, t) {
      return new a(t).inlineTokens(e);
    }
    lex(e) {
      e = e.replace(x.carriageReturn, `
`), this.blockTokens(e, this.tokens);
      for (let t = 0; t < this.inlineQueue.length; t++) {
        let n = this.inlineQueue[t];
        this.inlineTokens(n.src, n.tokens);
      }
      return this.inlineQueue = [], this.tokens;
    }
    blockTokens(e, t = [], n = false) {
      this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(x.tabCharGlobal, "    ").replace(x.spaceLine, ""));
      let i = 1 / 0;
      for (; e; ) {
        if (e.length < i) i = e.length;
        else {
          this.infiniteLoopError(e.charCodeAt(0));
          break;
        }
        let r;
        if (this.options.extensions?.block?.some((s) => (r = s.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
        if (r = this.tokenizer.space(e)) {
          e = e.substring(r.raw.length);
          let s = t.at(-1);
          r.raw.length === 1 && s !== void 0 ? s.raw += `
` : t.push(r);
          continue;
        }
        if (r = this.tokenizer.code(e)) {
          e = e.substring(r.raw.length);
          let s = t.at(-1);
          s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.at(-1).src = s.text) : t.push(r);
          continue;
        }
        if (r = this.tokenizer.fences(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.heading(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.hr(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.blockquote(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.list(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.html(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.def(e)) {
          e = e.substring(r.raw.length);
          let s = t.at(-1);
          s?.type === "paragraph" || s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.raw, this.inlineQueue.at(-1).src = s.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
          continue;
        }
        if (r = this.tokenizer.table(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        if (r = this.tokenizer.lheading(e)) {
          e = e.substring(r.raw.length), t.push(r);
          continue;
        }
        let o = e;
        if (this.options.extensions?.startBlock) {
          let s = 1 / 0, l = e.slice(1), u;
          this.options.extensions.startBlock.forEach((c) => {
            u = c.call({ lexer: this }, l), typeof u == "number" && u >= 0 && (s = Math.min(s, u));
          }), s < 1 / 0 && s >= 0 && (o = e.substring(0, s + 1));
        }
        if (this.state.top && (r = this.tokenizer.paragraph(o))) {
          let s = t.at(-1);
          n && s?.type === "paragraph" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r), n = o.length !== e.length, e = e.substring(r.raw.length);
          continue;
        }
        if (r = this.tokenizer.text(e)) {
          e = e.substring(r.raw.length);
          let s = t.at(-1);
          s?.type === "text" ? (s.raw += (s.raw.endsWith(`
`) ? "" : `
`) + r.raw, s.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = s.text) : t.push(r);
          continue;
        }
        if (e) {
          this.infiniteLoopError(e.charCodeAt(0));
          break;
        }
      }
      return this.state.top = true, t;
    }
    inline(e, t = []) {
      return this.inlineQueue.push({ src: e, tokens: t }), t;
    }
    linkInText(e) {
      if (!e.includes("[")) return false;
      let t = this.tokenizer.rules.inline.link;
      for (let n of e.matchAll(this.tokenizer.rules.inline.blockSkip)) if (t.test(n[0]) && e.charAt(n.index - 1) !== "!") return true;
      for (let n of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
        let i = n[0], r = i.lastIndexOf("[");
        if (!(i.charAt(0) === "!" || !Object.hasOwn(this.tokens.links, v(i.slice(r + 1, -1)))) && !(r > 1 && this.linkInText(i.slice(1, r - 1)))) return true;
      }
      return false;
    }
    inlineTokens(e, t = []) {
      this.tokenizer.lexer = this;
      let n = this.state.linkParenPossible;
      this.state.linkParenPossible = n && e.includes(")");
      try {
        return this.#e(e, t);
      } finally {
        this.state.linkParenPossible = n;
      }
    }
    #e(e, t) {
      let n = e;
      if (this.tokens.links && e.includes("[")) {
        let s = this.tokenizer.rules.inline.reflinkSearch, l = (u) => {
          let c = u.lastIndexOf("[");
          if (!Object.hasOwn(this.tokens.links, v(u.slice(c + 1, -1)))) return u;
          if (c > 1 && u.charAt(0) !== "!") {
            let p = u.slice(1, c - 1);
            if (this.linkInText(p)) return "[" + p.replace(s, l) + "][" + "a".repeat(u.length - c - 2) + "]";
          }
          return "[" + "a".repeat(u.length - 2) + "]";
        };
        n = n.replace(s, l);
      }
      n = n.replace(this.tokenizer.rules.inline.anyPunctuationOutsideCode, (s, l, u) => u ? "+".repeat(s.length) : l ? l + s.slice(l.length, -l.length).replace(/`/g, "+") + l : s), n = n.replace(this.tokenizer.rules.inline.blockSkip, (s, l, u) => {
        let c = u ? u.length : 0;
        return s.slice(0, c) + "[" + "a".repeat(s.length - c - 2) + "]";
      }), n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
      let i = false, r = "", o = 1 / 0;
      for (; e; ) {
        if (e.length < o) o = e.length;
        else {
          this.infiniteLoopError(e.charCodeAt(0));
          break;
        }
        i || (r = ""), i = false;
        let s;
        if (this.options.extensions?.inline?.some((u) => (s = u.call({ lexer: this }, e, t)) ? (e = e.substring(s.raw.length), t.push(s), true) : false)) continue;
        if (s = this.tokenizer.escape(e)) {
          e = e.substring(s.raw.length), t.push(s);
          continue;
        }
        if (s = this.tokenizer.tag(e)) {
          e = e.substring(s.raw.length), t.push(s);
          continue;
        }
        if (s = this.tokenizer.link(e)) {
          e = e.substring(s.raw.length), t.push(s);
          continue;
        }
        if (s = this.tokenizer.reflink(e, this.tokens.links)) {
          e = e.substring(s.raw.length);
          let u = t.at(-1);
          s.type === "text" && u?.type === "text" ? (u.raw += s.raw, u.text += s.text) : t.push(s);
          continue;
        }
        if (s = this.tokenizer.emStrong(e, n, r)) {
          e = e.substring(s.raw.length), t.push(s);
          continue;
        }
        if (s = this.tokenizer.codespan(e)) {
          e = e.substring(s.raw.length), t.push(s);
          continue;
        }
        if (s = this.tokenizer.br(e)) {
          e = e.substring(s.raw.length), t.push(s);
          continue;
        }
        if (s = this.tokenizer.del(e, n, r)) {
          e = e.substring(s.raw.length), t.push(s);
          continue;
        }
        if (s = this.tokenizer.autolink(e)) {
          e = e.substring(s.raw.length), t.push(s);
          continue;
        }
        if (!this.state.inLink && (s = this.tokenizer.url(e))) {
          e = e.substring(s.raw.length), t.push(s);
          continue;
        }
        let l = e;
        if (this.options.extensions?.startInline) {
          let u = 1 / 0, c = e.slice(1), p;
          this.options.extensions.startInline.forEach((d) => {
            p = d.call({ lexer: this }, c), typeof p == "number" && p >= 0 && (u = Math.min(u, p));
          }), u < 1 / 0 && u >= 0 && (l = e.substring(0, u + 1));
        }
        if (s = this.tokenizer.inlineText(l)) {
          e = e.substring(s.raw.length), s.raw.slice(-1) !== "_" && (r = s.raw.slice(-1)), i = true;
          let u = t.at(-1);
          u?.type === "text" ? (u.raw += s.raw, u.text += s.text) : t.push(s);
          continue;
        }
        if (e) {
          this.infiniteLoopError(e.charCodeAt(0));
          break;
        }
      }
      return t;
    }
    infiniteLoopError(e) {
      let t = "Infinite loop on byte: " + e;
      if (this.options.silent) console.error(t);
      else throw new Error(t);
    }
  };
  var $ = class {
    options;
    parser;
    constructor(e) {
      this.options = e || y;
    }
    space(e) {
      return "";
    }
    code({ text: e, lang: t, escaped: n }) {
      let i = (t || "").match(x.notSpaceStart)?.[0], r = e ? e.replace(x.endingNewline, "") + `
` : "";
      return i ? '<pre><code class="language-' + w(i) + '">' + (n ? r : w(r, true)) + `</code></pre>
` : "<pre><code>" + (n ? r : w(r, true)) + `</code></pre>
`;
    }
    blockquote({ tokens: e }) {
      return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
    }
    html({ text: e }) {
      return e;
    }
    def(e) {
      return "";
    }
    heading({ tokens: e, depth: t }) {
      return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
    }
    hr(e) {
      return `<hr>
`;
    }
    list(e) {
      let t = e.ordered, n = e.start, i = "";
      for (let s = 0; s < e.items.length; s++) {
        let l = e.items[s];
        i += this.listitem(l);
      }
      let r = t ? "ol" : "ul", o = t && n !== 1 ? ' start="' + n + '"' : "";
      return "<" + r + o + `>
` + i + "</" + r + `>
`;
    }
    listitem(e) {
      return `<li>${this.parser.parse(e.tokens)}</li>
`;
    }
    checkbox({ checked: e }) {
      return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
    }
    paragraph({ tokens: e }) {
      return `<p>${this.parser.parseInline(e)}</p>
`;
    }
    table(e) {
      let t = "", n = "";
      for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
      t += this.tablerow({ text: n });
      let i = "";
      for (let r = 0; r < e.rows.length; r++) {
        let o = e.rows[r];
        n = "";
        for (let s = 0; s < o.length; s++) n += this.tablecell(o[s]);
        i += this.tablerow({ text: n });
      }
      return i && (i = `<tbody>${i}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + i + `</table>
`;
    }
    tablerow({ text: e }) {
      return `<tr>
${e}</tr>
`;
    }
    tablecell(e) {
      let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
      return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
    }
    strong({ tokens: e }) {
      return `<strong>${this.parser.parseInline(e)}</strong>`;
    }
    em({ tokens: e }) {
      return `<em>${this.parser.parseInline(e)}</em>`;
    }
    codespan({ text: e }) {
      return `<code>${w(e, true)}</code>`;
    }
    br(e) {
      return "<br>";
    }
    del({ tokens: e }) {
      return `<del>${this.parser.parseInline(e)}</del>`;
    }
    link({ href: e, title: t, text: n, tokens: i, autolink: r }) {
      let o = r ? w(n, true) : this.parser.parseInline(i), s = ie(e);
      if (s === null) return o;
      e = w(s, r);
      let l = '<a href="' + e + '"';
      return t && (l += ' title="' + w(t) + '"'), l += ">" + o + "</a>", l;
    }
    image({ href: e, title: t, text: n, tokens: i }) {
      i && (n = this.parser.parseInline(i, this.parser.textRenderer));
      let r = ie(e);
      if (r === null) return w(n);
      e = r;
      let o = `<img src="${w(e)}" alt="${w(n)}"`;
      return t && (o += ` title="${w(t)}"`), o += ">", o;
    }
    text(e) {
      return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : w(e.text);
    }
  };
  var z = class {
    strong({ text: e }) {
      return e;
    }
    em({ text: e }) {
      return e;
    }
    codespan({ text: e }) {
      return e;
    }
    del({ text: e }) {
      return e;
    }
    html({ text: e }) {
      return e;
    }
    text({ text: e }) {
      return e;
    }
    link({ text: e }) {
      return "" + e;
    }
    image({ text: e }) {
      return "" + e;
    }
    br() {
      return "";
    }
    checkbox({ raw: e }) {
      return e;
    }
  };
  var O = class a2 {
    options;
    renderer;
    textRenderer;
    constructor(e) {
      this.options = e || y, this.options.renderer = this.options.renderer || new $(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new z();
    }
    static parse(e, t) {
      return new a2(t).parse(e);
    }
    static parseInline(e, t) {
      return new a2(t).parseInline(e);
    }
    parse(e) {
      this.renderer.parser = this;
      let t = "";
      for (let n = 0; n < e.length; n++) {
        let i = e[n];
        if (this.options.extensions?.renderers?.[i.type]) {
          let o = i, s = this.options.extensions.renderers[o.type].call({ parser: this }, o);
          if (s !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "checkbox", "html", "def", "paragraph", "text"].includes(o.type)) {
            t += s || "";
            continue;
          }
        }
        let r = i;
        switch (r.type) {
          case "space": {
            t += this.renderer.space(r);
            break;
          }
          case "hr": {
            t += this.renderer.hr(r);
            break;
          }
          case "heading": {
            t += this.renderer.heading(r);
            break;
          }
          case "code": {
            t += this.renderer.code(r);
            break;
          }
          case "table": {
            t += this.renderer.table(r);
            break;
          }
          case "blockquote": {
            t += this.renderer.blockquote(r);
            break;
          }
          case "list": {
            t += this.renderer.list(r);
            break;
          }
          case "checkbox": {
            t += this.renderer.checkbox(r);
            break;
          }
          case "html": {
            t += this.renderer.html(r);
            break;
          }
          case "def": {
            t += this.renderer.def(r);
            break;
          }
          case "paragraph": {
            t += this.renderer.paragraph(r);
            break;
          }
          case "text": {
            t += this.renderer.text(r);
            break;
          }
          default: {
            let o = 'Token with "' + r.type + '" type was not found.';
            if (this.options.silent) return console.error(o), "";
            throw new Error(o);
          }
        }
      }
      return t;
    }
    parseInline(e, t = this.renderer) {
      this.renderer.parser = this;
      let n = "";
      for (let i = 0; i < e.length; i++) {
        let r = e[i];
        if (this.options.extensions?.renderers?.[r.type]) {
          let s = this.options.extensions.renderers[r.type].call({ parser: this }, r);
          if (s !== false || !["escape", "html", "link", "image", "checkbox", "strong", "em", "codespan", "br", "del", "text"].includes(r.type)) {
            n += s || "";
            continue;
          }
        }
        let o = r;
        switch (o.type) {
          case "escape": {
            n += t.text(o);
            break;
          }
          case "html": {
            n += t.html(o);
            break;
          }
          case "link": {
            n += t.link(o);
            break;
          }
          case "image": {
            n += t.image(o);
            break;
          }
          case "checkbox": {
            n += t.checkbox(o);
            break;
          }
          case "strong": {
            n += t.strong(o);
            break;
          }
          case "em": {
            n += t.em(o);
            break;
          }
          case "codespan": {
            n += t.codespan(o);
            break;
          }
          case "br": {
            n += t.br(o);
            break;
          }
          case "del": {
            n += t.del(o);
            break;
          }
          case "text": {
            n += t.text(o);
            break;
          }
          default: {
            let s = 'Token with "' + o.type + '" type was not found.';
            if (this.options.silent) return console.error(s), "";
            throw new Error(s);
          }
        }
      }
      return n;
    }
  };
  var L = class {
    options;
    block;
    constructor(e) {
      this.options = e || y;
    }
    static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
    static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
    preprocess(e) {
      return e;
    }
    postprocess(e) {
      return e;
    }
    processAllTokens(e) {
      return e;
    }
    emStrongMask(e) {
      return e;
    }
    provideLexer(e = this.block) {
      return e ? T.lex : T.lexInline;
    }
    provideParser(e = this.block) {
      return e ? O.parse : O.parseInline;
    }
  };
  function C(a3, e) {
    if (Array.isArray(e)) for (let t = 0; t < e.length; t++) a3.push(e[t]);
    else a3.push(e);
  }
  var U = class {
    defaults = B();
    options = this.setOptions;
    parse = this.parseMarkdown(true);
    parseInline = this.parseMarkdown(false);
    Parser = O;
    Renderer = $;
    TextRenderer = z;
    Lexer = T;
    Tokenizer = _;
    Hooks = L;
    constructor(...e) {
      this.use(...e);
    }
    walkTokens(e, t) {
      let n = [];
      for (let i of e) switch (C(n, t.call(this, i)), i.type) {
        case "table": {
          let r = i;
          for (let o of r.header) C(n, this.walkTokens(o.tokens, t));
          for (let o of r.rows) for (let s of o) C(n, this.walkTokens(s.tokens, t));
          break;
        }
        case "list": {
          let r = i;
          C(n, this.walkTokens(r.items, t));
          break;
        }
        default: {
          let r = i;
          this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((o) => {
            let s = r[o].flat(1 / 0);
            C(n, this.walkTokens(s, t));
          }) : r.tokens && C(n, this.walkTokens(r.tokens, t));
        }
      }
      return n;
    }
    use(...e) {
      let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
      return e.forEach((n) => {
        let i = { ...n };
        if (i.async = this.defaults.async || i.async || false, n.extensions && (n.extensions.forEach((r) => {
          if (!r.name) throw new Error("extension name required");
          if ("renderer" in r) {
            let o = t.renderers[r.name];
            o ? t.renderers[r.name] = function(...s) {
              let l = r.renderer.apply(this, s);
              return l === false && (l = o.apply(this, s)), l;
            } : t.renderers[r.name] = r.renderer;
          }
          if ("tokenizer" in r) {
            if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
            let o = t[r.level];
            o ? o.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
          }
          "childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
        }), i.extensions = t), n.renderer) {
          let r = this.defaults.renderer || new $(this.defaults);
          for (let o in n.renderer) {
            if (!(o in r)) throw new Error(`renderer '${o}' does not exist`);
            if (["options", "parser"].includes(o)) continue;
            let s = o, l = n.renderer[s], u = r[s];
            r[s] = (...c) => {
              let p = l.apply(r, c);
              return p === false && (p = u.apply(r, c)), p || "";
            };
          }
          i.renderer = r;
        }
        if (n.tokenizer) {
          let r = this.defaults.tokenizer || new _(this.defaults);
          for (let o in n.tokenizer) {
            if (!(o in r)) throw new Error(`tokenizer '${o}' does not exist`);
            if (["options", "rules", "lexer"].includes(o)) continue;
            let s = o, l = n.tokenizer[s], u = r[s];
            r[s] = (...c) => {
              let p = l.apply(r, c);
              return p === false && (p = u.apply(r, c)), p;
            };
          }
          i.tokenizer = r;
        }
        if (n.hooks) {
          let r = this.defaults.hooks || new L();
          for (let o in n.hooks) {
            if (!(o in r)) throw new Error(`hook '${o}' does not exist`);
            if (["options", "block"].includes(o)) continue;
            let s = o, l = n.hooks[s], u = r[s];
            L.passThroughHooks.has(o) ? r[s] = (c) => {
              if (this.defaults.async && L.passThroughHooksRespectAsync.has(o)) return (async () => {
                let d = await l.call(r, c);
                return u.call(r, d);
              })();
              let p = l.call(r, c);
              return u.call(r, p);
            } : r[s] = (...c) => {
              if (this.defaults.async) return (async () => {
                let d = await l.apply(r, c);
                return d === false && (d = await u.apply(r, c)), d;
              })();
              let p = l.apply(r, c);
              return p === false && (p = u.apply(r, c)), p;
            };
          }
          i.hooks = r;
        }
        if (n.walkTokens) {
          let r = this.defaults.walkTokens, o = n.walkTokens;
          i.walkTokens = function(s) {
            let l = [];
            return l.push(o.call(this, s)), r && C(l, r.call(this, s)), l;
          };
        }
        this.defaults = { ...this.defaults, ...i };
      }), this;
    }
    setOptions(e) {
      return this.defaults = { ...this.defaults, ...e }, this;
    }
    lexer(e, t) {
      return T.lex(e, t ?? this.defaults);
    }
    parser(e, t) {
      return O.parse(e, t ?? this.defaults);
    }
    parseMarkdown(e) {
      return (n, i) => {
        let r = { ...i }, o = { ...this.defaults, ...r }, s = this.onError(!!o.silent, !!o.async);
        if (this.defaults.async === true && r.async === false) return s(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
        if (typeof n > "u" || n === null) return s(new Error("marked(): input parameter is undefined or null"));
        if (typeof n != "string") return s(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
        if (o.hooks && (o.hooks.options = o, o.hooks.block = e), o.async) return (async () => {
          let l = o.hooks ? await o.hooks.preprocess(n) : n, c = await (o.hooks ? await o.hooks.provideLexer(e) : e ? T.lex : T.lexInline)(l, o), p = o.hooks ? await o.hooks.processAllTokens(c) : c;
          o.walkTokens && await Promise.all(this.walkTokens(p, o.walkTokens));
          let g = await (o.hooks ? await o.hooks.provideParser(e) : e ? O.parse : O.parseInline)(p, o);
          return o.hooks ? await o.hooks.postprocess(g) : g;
        })().catch(s);
        try {
          o.hooks && (n = o.hooks.preprocess(n));
          let u = (o.hooks ? o.hooks.provideLexer(e) : e ? T.lex : T.lexInline)(n, o);
          o.hooks && (u = o.hooks.processAllTokens(u)), o.walkTokens && this.walkTokens(u, o.walkTokens);
          let p = (o.hooks ? o.hooks.provideParser(e) : e ? O.parse : O.parseInline)(u, o);
          return o.hooks && (p = o.hooks.postprocess(p)), p;
        } catch (l) {
          return s(l);
        }
      };
    }
    onError(e, t) {
      return (n) => {
        if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
          let i = "<p>An error occurred:</p><pre>" + w(n.message + "", true) + "</pre>";
          return t ? Promise.resolve(i) : i;
        }
        if (t) return Promise.reject(n);
        throw n;
      };
    }
  };
  var I = new U();
  function f(a3, e) {
    return I.parse(a3, e);
  }
  f.options = f.setOptions = function(a3) {
    return I.setOptions(a3), f.defaults = I.defaults, V(f.defaults), f;
  };
  f.getDefaults = B;
  f.defaults = y;
  function At(...a3) {
    return I.use(...a3), f.defaults = I.defaults, V(f.defaults), f;
  }
  f.use = At;
  f.walkTokens = function(a3, e) {
    return I.walkTokens(a3, e);
  };
  f.parseInline = I.parseInline;
  f.Parser = O;
  f.parser = O.parse;
  f.Renderer = $;
  f.TextRenderer = z;
  f.Lexer = T;
  f.lexer = T.lex;
  f.Tokenizer = _;
  f.Hooks = L;
  f.parse = f;
  var Rn = f.options;
  var Tn = f.setOptions;
  var On = f.walkTokens;
  var wn = f.parseInline;
  var yn = O.parse;
  var Sn = T.lex;

  // src/shared/html.ts
  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  // src/shared/announcement-markdown.ts
  var ANNOUNCEMENT_MAX_LENGTH = 2e4;
  function announcementLink(href) {
    if (!href || /[\s\\<>\u0000-\u001f\u007f]/.test(href)) return null;
    if (/^\/(?!\/)/.test(href) || /^#[^#]/.test(href)) return href;
    if (!/^(https?:\/\/|mailto:)/i.test(href)) return null;
    try {
      const url = new URL(href);
      if (url.username || url.password) return null;
      return ["http:", "https:", "mailto:"].includes(url.protocol) ? href : null;
    } catch {
      return null;
    }
  }
  var markdown = new U({
    async: false,
    gfm: true,
    breaks: true,
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens);
        const safe = announcementLink(href);
        return safe ? `<a href="${escapeHtml(safe)}">${label}</a>` : label;
      },
      image({ text }) {
        return escapeHtml(text);
      },
      heading({ depth, tokens }) {
        const level = Math.max(2, depth);
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>
`;
      },
      table(token) {
        return `<div class="announcement-table">${$.prototype.table.call(this, token)}</div>`;
      }
    }
  });
  function renderAnnouncement(content, publicOrigin = "") {
    try {
      return markdown.parse(content, { async: false }).replaceAll('<a href="/', `<a href="${escapeHtml(publicOrigin)}/`);
    } catch {
      return `<p>${escapeHtml(content).replace(/\r?\n/g, "<br>")}</p>`;
    }
  }

  // src/client/announcement-editor.js
  var editor = document.querySelector("[data-announcement-editor]");
  if (editor) {
    const content = editor.querySelector('[name="content"]');
    const title = editor.querySelector('[name="title"]');
    const preview = editor.querySelector("#announcement-preview");
    const toggle = editor.querySelector("[data-preview-toggle]");
    const status = editor.querySelector("[data-editor-status]");
    const linkPanel = editor.querySelector("#announcement-link");
    const linkOpen = editor.querySelector("[data-link-open]");
    const linkLabel = editor.querySelector("[data-link-label]");
    const linkUrl = editor.querySelector("[data-link-url]");
    let selection = [0, 0];
    const rememberSelection = () => selection = [content.selectionStart, content.selectionEnd];
    const markdownText = (text) => text.replace(/[\\`*_[\]<>#]/g, "\\$&");
    const updatePreview = () => {
      if (preview.hidden) return;
      editor.querySelector("[data-preview-title]").textContent = title.value || "\u672A\u586B\u5199\u6807\u9898";
      const body = editor.querySelector("[data-preview-body]");
      body.innerHTML = renderAnnouncement(content.value, editor.dataset.publicOrigin);
      for (const link of body.querySelectorAll("a")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    };
    const insert = (text) => {
      if (content.value.length - (selection[1] - selection[0]) + text.length > ANNOUNCEMENT_MAX_LENGTH) {
        status.textContent = "\u63D2\u5165\u540E\u4F1A\u8D85\u8FC7 20,000 \u5B57\u7B26\uFF0C\u8BF7\u5148\u7CBE\u7B80\u6B63\u6587\u3002";
        return false;
      }
      content.setRangeText(text, ...selection, "end");
      content.focus();
      rememberSelection();
      updatePreview();
      return true;
    };
    const closeLink = () => {
      linkPanel.hidden = true;
      linkOpen.setAttribute("aria-expanded", "false");
      linkOpen.focus();
    };
    content.addEventListener("input", updatePreview);
    title.addEventListener("input", updatePreview);
    toggle.addEventListener("click", () => {
      preview.hidden = !preview.hidden;
      toggle.setAttribute("aria-expanded", String(!preview.hidden));
      toggle.textContent = preview.hidden ? "\u9884\u89C8\u516C\u544A" : "\u6536\u8D77\u9884\u89C8";
      updatePreview();
      status.textContent = preview.hidden ? "\u5DF2\u6536\u8D77\u9884\u89C8\u3002" : "\u9884\u89C8\u5DF2\u663E\u793A\u5728\u7F16\u8F91\u533A\u4E0B\u65B9\uFF0C\u7EE7\u7EED\u7F16\u8F91\u4F1A\u540C\u6B65\u66F4\u65B0\u3002";
    });
    for (const button of editor.querySelectorAll("[data-format]")) {
      button.addEventListener("click", () => {
        rememberSelection();
        const selected = content.value.slice(...selection);
        const formats = {
          bold: `**${selected || "\u5F3A\u8C03\u6587\u5B57"}**`,
          heading: `

## ${selected || "\u5C0F\u6807\u9898"}

`,
          list: `

${(selected || "\u5217\u8868\u9879\u76EE").split("\n").map((line) => `- ${line}`).join("\n")}

`
        };
        if (insert(formats[button.dataset.format])) status.textContent = "\u5DF2\u63D2\u5165\u683C\u5F0F\uFF0C\u53EF\u4FEE\u6539\u6587\u5B57\u540E\u9884\u89C8\u3002";
      });
    }
    linkOpen.addEventListener("click", () => {
      if (!linkPanel.hidden) return closeLink();
      rememberSelection();
      linkLabel.value = content.value.slice(...selection);
      linkUrl.value = "";
      linkPanel.hidden = false;
      linkOpen.setAttribute("aria-expanded", "true");
      (linkLabel.value ? linkUrl : linkLabel).focus();
    });
    editor.querySelector("[data-link-cancel]").addEventListener("click", closeLink);
    const insertLink = () => {
      const href = announcementLink(linkUrl.value.trim());
      const label = linkLabel.value.trim();
      if (!href || !label) {
        status.textContent = "\u8BF7\u586B\u5199\u94FE\u63A5\u6587\u5B57\uFF0C\u4EE5\u53CA / \u5F00\u5934\u7684\u672C\u7AD9\u8DEF\u5F84\u3001http/https \u7F51\u5740\u6216 mailto \u90AE\u7BB1\u3002";
        (!label ? linkLabel : linkUrl).focus();
        return;
      }
      if (!insert(`[${markdownText(label)}](<${href}>)`)) return;
      linkPanel.hidden = true;
      linkOpen.setAttribute("aria-expanded", "false");
      status.textContent = "\u94FE\u63A5\u5DF2\u63D2\u5165\u3002\u70B9\u51FB\u9884\u89C8\u53EF\u67E5\u770B\u548C\u8BD5\u5F00\u94FE\u63A5\u3002";
    };
    editor.querySelector("[data-link-insert]").addEventListener("click", insertLink);
    linkPanel.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        if (event.key === "Escape") closeLink();
        else insertLink();
      }
    });
    content.addEventListener("paste", (event) => {
      const html = event.clipboardData?.getData("text/html");
      if (!html || html.length > 2e5) return;
      const template = document.createElement("template");
      template.innerHTML = html;
      if (!template.content.querySelector("a[href]")) return;
      const convert = (node, depth = 0) => {
        if (node.nodeType === Node.TEXT_NODE) return markdownText(node.textContent || "");
        if (node.nodeType !== Node.ELEMENT_NODE || depth > 30) return "";
        const tag = node.tagName.toLowerCase();
        if (["script", "style", "iframe", "object", "svg", "math", "template", "input", "button"].includes(tag))
          return "";
        if (tag === "img") return markdownText(node.getAttribute("alt") || "");
        const children = () => [...node.childNodes].map((child) => convert(child, depth + 1)).join("");
        if (tag === "a") {
          const href = announcementLink(node.getAttribute("href") || "");
          return href ? `[${children().trim() || markdownText(href)}](<${href}>)` : children();
        }
        if (tag === "br") return "\n";
        if (["strong", "b"].includes(tag)) return `**${children().trim()}**`;
        if (["em", "i"].includes(tag)) return `*${children().trim()}*`;
        if (/^h[1-6]$/.test(tag)) return `

${"#".repeat(Number(tag[1]))} ${children().trim()}

`;
        if (tag === "ul" || tag === "ol") {
          const items = [...node.children].filter((child) => child.tagName === "LI");
          return "\n\n" + items.map((item, index) => {
            const prefix = tag === "ol" ? `${index + 1}. ` : "- ";
            const text = convert(item, depth + 1).trim().replace(/\n/g, "\n" + " ".repeat(prefix.length));
            return prefix + text;
          }).join("\n") + "\n\n";
        }
        if (["p", "div", "section", "article"].includes(tag)) return `

${children()}

`;
        return children();
      };
      const converted = [...template.content.childNodes].map((node) => convert(node)).join("").replace(/\n{3,}/g, "\n\n").trim();
      if (!converted) return;
      event.preventDefault();
      rememberSelection();
      if (insert(converted)) status.textContent = "\u5DF2\u5C06\u7C98\u8D34\u5185\u5BB9\u8F6C\u6362\u4E3A Markdown \u5E76\u4FDD\u7559\u53EF\u7528\u94FE\u63A5\uFF0C\u8BF7\u9884\u89C8\u786E\u8BA4\u3002";
    });
    editor.querySelector("[data-editor-tools]").hidden = false;
    toggle.hidden = false;
  }
})();
