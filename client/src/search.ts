// Fuzzy text search that tolerates common Japanese notation variants
// (表記の揺らぎ):
// - full-width / half-width and letter case (NFKC + lowercase)
// - hiragana vs katakana
// - kana vs romaji spelling: a kana string also matches its romaji
// rendering, so コミティア hits COMITIA-style names and vice versa
// - well-known spellings whose romaji conversion differs from the
// official latin spelling are absorbed by the alias dictionary
// (コミティア -> comitia, コミケ -> comicmarket)
// - 都道府県 / 市区町村 suffixes on place names (福岡 hits 福岡県・福岡市)

const SINGLE_ROMAJI: Record<string, string> = {
あ: "a", い: "i", う: "u", え: "e", お: "o",
か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
や: "ya", ゆ: "yu", よ: "yo",
ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
わ: "wa", ゐ: "wi", ゑ: "we", を: "wo", ん: "n",
が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa", ゕ: "ka", ゖ: "ke",
ゔ: "vu",
};

const COMBO_ROMAJI: Record<string, string> = {
きゃ: "kya", きゅ: "kyu", きょ: "kyo",
しゃ: "sha", しゅ: "shu", しょ: "sho",
ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
にゃ: "nya", にゅ: "nyu", にょ: "nyo",
ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
みゃ: "mya", みゅ: "myu", みょ: "myo",
りゃ: "rya", りゅ: "ryu", りょ: "ryo",
ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
じゃ: "ja", じゅ: "ju", じょ: "jo",
ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
びゃ: "bya", びゅ: "byu", びょ: "byo",
ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du",
ちぇ: "che", しぇ: "she", じぇ: "je",
ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
うぃ: "wi", うぇ: "we", うぉ: "wo",
ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso",
くぁ: "kwa", くぃ: "kwi", くぇ: "kwe", くぉ: "kwo",
};

// Alias dictionary, applied to the normalized (hiragana / lowercase)
// form of both the query and the target text. Keys are spellings a user
// or a stored name might use; values are the canonical spelling.
const ALIASES: [string, string][] = [
["こみてぃあ", "comitia"],
["komitia", "comitia"],
["こみっくまーけっと", "comicmarket"],
["こみけ", "comicmarket"],
["comiket", "comicmarket"],
];

function katakanaToHiragana(s: string): string {
return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Base normalization: width/case, katakana->hiragana, strip spaces & punctuation, apply aliases. */
function normalizeText(s: string): string {
let t = s.normalize("NFKC").toLowerCase();
t = katakanaToHiragana(t);
t = t.replace(
/[\s・･、。,.，,：:；;／/\\｜|（）()「」『』［］\[\]{}<>＜＞"“”'‘’`~〜!！?？@＠#＃$＄%％^＾&＆*＊+＋=＝_-]/g,
"",
);
for (const [from, to] of ALIASES) {
t = t.split(from).join(to);
}
return t;
}

/** Convert a hiragana-containing string to romaji; other characters pass through. */
function toRomaji(s: string): string {
let out = "";
let geminate = false;
let i = 0;
while (i < s.length) {
const ch = s[i]?? "";
if (ch === "っ") {
geminate = true;
i += 1;
continue;
}
if (ch === "ー") {
const m = /[aiueo]$/.exec(out);
if (m) out += m[0];
i += 1;
continue;
}
let r = COMBO_ROMAJI[s.slice(i, i + 2)];
let len = 2;
if (r === undefined) {
r = SINGLE_ROMAJI[ch];
len = 1;
}
if (r === undefined) {
out += ch;
geminate = false;
i += 1;
continue;
}
if (geminate) {
if (r.startsWith("ch")) r = `t${r}`;
else if (/^[bcdfghjklmnpqrstvwyz]/.test(r)) r = r.charAt(0) + r;
geminate = false;
}
out += r;
i += len;
}
return out;
}

function stripPlaceSuffix(v: string): string {
const stripped = v.replace(/[都道府県市区町村]$/, "");
return stripped.length > 0? stripped: v;
}

/** All normalized spellings under which a text can be found. */
function variants(s: string): string[] {
const base = normalizeText(s);
if (!base) return [];
const noLongMark = base.replace(/ー/g, "");
const set = new Set<string>([
base,
noLongMark,
toRomaji(base),
stripPlaceSuffix(base),
stripPlaceSuffix(noLongMark),
]);
set.delete("");
return [...set];
}

/**
* Returns true when every whitespace-separated term of `query` fuzzy-matches
* at least one of the target texts. An empty query matches everything.
*/
export function matchesQuery(
query: string,
...targets: (string | null | undefined)[]
): boolean {
const terms = query
.normalize("NFKC")
.split(/\s+/)
.map((t) => t.trim())
.filter((t) => t.length > 0);
if (terms.length === 0) return true;
const targetVariants = targets.flatMap((t) => (t? variants(t): []));
if (targetVariants.length === 0) return false;
return terms.every((term) => {
const qv = variants(term);
return qv.some((q) => targetVariants.some((tv) => tv.includes(q)));
});
}

/**
 * Place-name matching (prefectures and cities): equality over the
 * normalized variant sets, NOT substring matching. Substring matching
 * would let 京都 hit 東京都 （京都 is contained in 東京都 once suffixes
 * are stripped). Suffix-less spellings still count as the same place
 * （京都 ⇔ 京都府, 東京 ⇔ 東京都, 京都 ⇔ 京都市） because both sides
 * contribute their suffix-stripped and romaji variants to the compared
 * sets. An empty query matches everything.
 */
export function matchesPlaceName(
query: string,
target: string | null | undefined,
): boolean {
if (!query.trim()) return true;
if (!target) return false;
const queryVariants = new Set(variants(query));
return variants(target).some((v) => queryVariants.has(v));
}
