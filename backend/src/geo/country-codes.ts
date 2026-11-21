/**
 * @module geo/country-codes
 *
 * ISO 3166-1 alpha-3 to alpha-2 country codes, for the services that answer alpha-3 codes (Amazon Location
 * gives both, alpha-3 always). The 249 codes of ISO 3166-1, and Kosovo (`XK`, written `XKS` or `XKX`), which
 * every advertising platform targets. Transcribed from multi-search (`src/geo/country-codes.ts`).
 */

/** Pairs of codes, alpha-3 then alpha-2, five letters each. */
const PAIRS: string =
  'ABWAW AFGAF AGOAO AIAAI ALAAX ALBAL ANDAD AREAE ARGAR ARMAM ASMAS ATAAQ ATFTF ATGAG AUSAU AUTAT AZEAZ ' +
  'BDIBI BELBE BENBJ BESBQ BFABF BGDBD BGRBG BHRBH BHSBS BIHBA BLMBL BLRBY BLZBZ BMUBM BOLBO BRABR BRBBB ' +
  'BRNBN BTNBT BVTBV BWABW CAFCF CANCA CCKCC CHECH CHLCL CHNCN CIVCI CMRCM CODCD COGCG COKCK COLCO COMKM ' +
  'CPVCV CRICR CUBCU CUWCW CXRCX CYMKY CYPCY CZECZ DEUDE DJIDJ DMADM DNKDK DOMDO DZADZ ECUEC EGYEG ERIER ' +
  'ESHEH ESPES ESTEE ETHET FINFI FJIFJ FLKFK FRAFR FROFO FSMFM GABGA GBRGB GEOGE GGYGG GHAGH GIBGI GINGN ' +
  'GLPGP GMBGM GNBGW GNQGQ GRCGR GRDGD GRLGL GTMGT GUFGF GUMGU GUYGY HKGHK HMDHM HNDHN HRVHR HTIHT HUNHU ' +
  'IDNID IMNIM INDIN IOTIO IRLIE IRNIR IRQIQ ISLIS ISRIL ITAIT JAMJM JEYJE JORJO JPNJP KAZKZ KENKE KGZKG ' +
  'KHMKH KIRKI KNAKN KORKR KWTKW LAOLA LBNLB LBRLR LBYLY LCALC LIELI LKALK LSOLS LTULT LUXLU LVALV MACMO ' +
  'MAFMF MARMA MCOMC MDAMD MDGMG MDVMV MEXMX MHLMH MKDMK MLIML MLTMT MMRMM MNEME MNGMN MNPMP MOZMZ MRTMR ' +
  'MSRMS MTQMQ MUSMU MWIMW MYSMY MYTYT NAMNA NCLNC NERNE NFKNF NGANG NICNI NIUNU NLDNL NORNO NPLNP NRUNR ' +
  'NZLNZ OMNOM PAKPK PANPA PCNPN PERPE PHLPH PLWPW PNGPG POLPL PRIPR PRKKP PRTPT PRYPY PSEPS PYFPF QATQA ' +
  'REURE ROURO RUSRU RWARW SAUSA SDNSD SENSN SGPSG SGSGS SHNSH SJMSJ SLBSB SLESL SLVSV SMRSM SOMSO SPMPM ' +
  'SRBRS SSDSS STPST SURSR SVKSK SVNSI SWESE SWZSZ SXMSX SYCSC SYRSY TCATC TCDTD TGOTG THATH TJKTJ TKLTK ' +
  'TKMTM TLSTL TONTO TTOTT TUNTN TURTR TUVTV TWNTW TZATZ UGAUG UKRUA UMIUM URYUY USAUS UZBUZ VATVA VCTVC ' +
  'VENVE VGBVG VIRVI VNMVN VUTVU WLFWF WSMWS XKSXK XKXXK YEMYE ZAFZA ZMBZM ZWEZW ';

/** Alpha-2 code of each alpha-3 code. */
const ALPHA2: ReadonlyMap<string, string> = new Map(
  PAIRS.trim()
    .split(' ')
    .map((pair: string): [string, string] => [pair.slice(0, 3), pair.slice(3)])
);

/**
 * The ISO 3166-1 alpha-2 code of a country.
 *
 * @param code - An alpha-2 or alpha-3 code, any case
 * @returns The alpha-2 code, or `null` for an unknown code
 *
 * @example
 * ```typescript
 * toAlpha2('FRA'); // 'FR'
 * toAlpha2('fr'); // 'FR'
 * ```
 */
export function toAlpha2(code: string): string | null {
  const upper: string = code.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return ALPHA2.get(upper) ?? null;
}
