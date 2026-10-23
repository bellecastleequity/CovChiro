// Site languages (owner, Oct 2026): English (default) plus Spanish and Haitian Creole landing pages at
// /es/ and /ht/. The flag switcher in the header links between them. Wording was reviewed for native
// phrasing; have a native speaker on staff sign off on the Spanish and Creole before buying media.
import { type Branch, WEEK, isPlaceholder } from './site';

export type Lang = 'en' | 'es' | 'ht';

/** Header switcher entries. `flag` picks the flag drawn in LangToggle.astro (us, pr, mx, es, ht). */
export const LANGS: { code: Lang; path: string; label: string; short: string; flag: string; locale: string; og: string }[] = [
  { code: 'en', path: '/', label: 'English', short: 'EN', flag: 'us', locale: 'en-US', og: 'en_US' },
  // Spain's flag for Spanish (owner, Oct 2026). Other flags available: 'pr' (Puerto Rico), 'mx' (Mexico).
  { code: 'es', path: '/es/', label: 'Español', short: 'ES', flag: 'es', locale: 'es-US', og: 'es_US' },
  { code: 'ht', path: '/ht/', label: 'Kreyòl ayisyen', short: 'KR', flag: 'ht', locale: 'ht', og: 'ht_HT' },
];
export const langInfo = (l: Lang) => LANGS.find((x) => x.code === l)!;

const DAYS: Record<Lang, string[]> = {
  en: WEEK.map((d) => d.slice(0, 3)),
  es: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
  ht: ['lendi', 'madi', 'mèkredi', 'jedi', 'vandredi', 'samdi', 'dimanch'],
};
const time = (t: string, l: Lang) => {
  const [h, m] = t.split(':').map(Number);
  const h12 = h % 12 || 12;
  const mm = m ? `:${String(m).padStart(2, '0')}` : '';
  if (l === 'es') return `${h12}${mm} ${h >= 12 ? 'p. m.' : 'a. m.'}`;
  if (l === 'ht') return `${h12}${mm} ${h >= 12 ? 'pm' : 'am'}`;
  return `${h12}${mm} ${h >= 12 ? 'pm' : 'am'}`;
};
/** "lun, mié, jue · 1 p. m. – 6 p. m." in the page's language. */
export const hoursIn = (b: Branch, l: Lang) => {
  if (!b.hours.length) return '';
  const groups = new Map<string, string[]>();
  for (const h of b.hours) {
    const k = `${time(h.opens, l)} – ${time(h.closes, l)}`;
    groups.set(k, [...(groups.get(k) ?? []), DAYS[l][WEEK.indexOf(h.day)]]);
  }
  return [...groups].map(([t, d]) => `${d.join(', ')} · ${t}`).join('; ');
};

/** Whether a location says it speaks this language (content editor → location → Languages spoken). */
export const speaks = (b: Branch | undefined, l: Lang) => {
  const langs = (b?.features.languages ?? []).map((x) => x.toLowerCase());
  if (l === 'es') return langs.some((x) => /espa|spanish/.test(x));
  if (l === 'ht') return langs.some((x) => /kreyòl|kreyol|creole|haitian/.test(x));
  return true;
};

/** Shared interface text. English values are the site's existing wording. */
const UI = {
  en: {
    pipAria: 'Car accident reminder',
    pipLong: 'Hurt in a car accident? Get checked within 14 days.',
    pipLongSub: 'We’ll see you with or without a referral.',
    pipShort: 'Car accident? Get checked within 14 days.',
    pipShortSub: 'No referral needed.',
    call: 'Call', callUs: 'Call us', days: 'DAYS',
    requestVisit: 'Request a visit', bookOnline: 'Book online', getNotified: 'Get notified', requestShort: 'Request visit', findLocation: 'Find a location',
    directions: 'Directions', newTab: '(opens in a new tab)', quickActions: 'Quick actions', menu: 'Menu', language: 'Language',
    ctaTitle: 'Hurt in a car accident? Get checked within 14 days.',
    ctaBody: 'Florida PIP generally requires initial care within 14 days of a crash. We’ll see you with or without a referral. Call us or request a visit online.',
    howItWorks: 'How it works', howHref: '/auto-accident-injuries/',
    callNow: 'Call now', text: 'Text', textPrompt: 'Prefer to text?', textBody: 'Hi, I was in a car accident and would like to schedule a visit.', smsNote: 'Msg & data rates may apply. Reply STOP to opt out.',
    callOrText: 'Call or text', hearIt: 'Hear it', hearAria: (v: string) => `Hear the ${v} jingle`, jingle: '/media/844-84-treat-jingle.mp3',
    transcript: 'Transcript',
    videoFine: 'Educational only; your policy and insurer determine coverage. Chiropractic care by Florida-licensed chiropractic physicians (D.C.). People shown are illustrative, not patients.',
    mainLine: 'Main line:',
    footBlurb: 'Calm, chiropractic-focused care for people recovering from auto accident injuries, neck and back pain, and everyday strain.',
    locations: 'Locations', comingSoon: 'Coming soon', followUs: 'Follow us',
    licensed: 'Chiropractic care is provided by Florida-licensed chiropractic physicians.',
    disclaimer: 'The information on this website is for general educational purposes only and is not medical advice. Reading it does not create a doctor–patient relationship. Every injury is different; please consult a licensed provider about your situation. If you have a medical emergency, call 911.',
    privacy: 'Privacy Policy', accessibility: 'Accessibility Statement', moreEnglish: '', skip: 'Skip to content',
    // Appointment form
    fTitle: 'Request an appointment', fNotifyTitle: (city: string) => `Get notified when ${city} opens`,
    fIntro: (city: string) => `Send a request and our ${city} team will call to confirm a time.`, fHours: 'Office hours:',
    fNotifyIntro: (name: string) => `Leave your name and number and we will call you when ${name} opens.`,
    fPrivacy: '<strong>Please do not include</strong> medical details, insurance or claim numbers, or Social Security numbers. We’ll collect what’s needed privately at your visit.',
    fName: 'Full name', fPhone: 'Phone number', fPhoneHint: 'We’ll call or text this number to confirm.',
    fTime: 'Preferred day and time', fTimePh: 'e.g., Monday after 3 pm', fAccident: 'Accident date', fOptional: '(optional)',
    fAccidentHint: 'Helps us prioritize visits inside the 14-day PIP window.',
    fConsentFallback: (name: string) => `I agree that ${name} may call or text me about this request.`,
    fSend: 'Send request', fNotify: 'Notify me', fPrefer: 'Prefer to call?', fHoneypot: 'Leave this field empty',
    fOk: 'Thank you. Your request was sent and our team will call you soon.',
    fMissing: 'Please complete the required fields: name, phone number, and contact consent.',
    fSending: 'Sending…', fFail: 'Sorry, your request could not be sent. Please call the office instead.',
  },
  es: {
    pipAria: 'Recordatorio sobre accidentes de auto',
    pipLong: '¿Se lesionó en un accidente de auto? Hágase un chequeo dentro de los 14 días.',
    pipLongSub: 'Lo atendemos con o sin referido.',
    pipShort: '¿Accidente de auto? Chequeo dentro de los 14 días.',
    pipShortSub: 'No necesita referido.',
    call: 'Llame', callUs: 'Llámenos', days: 'DÍAS',
    requestVisit: 'Solicite una cita', bookOnline: 'Reserve en línea', getNotified: 'Avísenme', requestShort: 'Pedir cita', findLocation: 'Ver ubicaciones',
    directions: 'Cómo llegar', newTab: '(se abre en otra pestaña)', quickActions: 'Acciones rápidas', menu: 'Menú', language: 'Idioma',
    ctaTitle: '¿Se lesionó en un accidente de auto? Hágase un chequeo dentro de los 14 días.',
    ctaBody: 'El PIP de Florida generalmente requiere la atención inicial dentro de los 14 días después del choque. Lo atendemos con o sin referido. Llámenos o solicite una cita en línea.',
    howItWorks: 'Cómo funciona', howHref: '#como-funciona',
    callNow: 'Llame ahora', text: 'Texto', textPrompt: '¿Prefiere enviar un texto?', textBody: 'Hola, tuve un accidente de auto y quiero hacer una cita.', smsNote: 'Pueden aplicar tarifas de mensajes y datos. Responda STOP para no recibir más mensajes.',
    callOrText: 'Llame o envíe un texto', hearIt: 'Escúchelo', hearAria: (v: string) => `Escuche el jingle de ${v}`, jingle: '/media/844-84-treat-jingle-es.mp3',
    transcript: 'Transcripción',
    videoFine: 'Solo con fines educativos; su póliza y su aseguradora determinan la cobertura. Atención quiropráctica por quiroprácticos con licencia en Florida (D.C.). Las personas que aparecen son ilustrativas, no pacientes.',
    mainLine: 'Línea principal:',
    footBlurb: 'Atención quiropráctica para personas que se recuperan de lesiones por accidentes de auto, dolor de cuello y espalda, y tensión del día a día.',
    locations: 'Ubicaciones', comingSoon: 'Próximamente', followUs: 'Síganos',
    licensed: 'La atención quiropráctica la brindan quiroprácticos con licencia en Florida.',
    disclaimer: 'La información de este sitio es solo educativa y no es consejo médico. Leerla no crea una relación médico-paciente. Cada lesión es diferente; consulte a un profesional con licencia sobre su caso. Si tiene una emergencia médica, llame al 911.',
    privacy: 'Política de privacidad (en inglés)', accessibility: 'Accesibilidad (en inglés)', moreEnglish: 'Sitio completo en inglés', skip: 'Ir al contenido',
    fTitle: 'Solicite una cita', fNotifyTitle: (city: string) => `Avísenme cuando abra ${city}`,
    fIntro: (city: string) => `Envíe su solicitud y nuestro equipo de ${city} lo llamará para confirmar la hora.`, fHours: 'Horario:',
    fNotifyIntro: (name: string) => `Déjenos su nombre y número, y lo llamaremos cuando abra ${name}.`,
    fPrivacy: '<strong>Por favor, no incluya</strong> detalles médicos, números de seguro o de reclamo, ni su número de Seguro Social. Recogemos lo necesario en privado durante su visita.',
    fName: 'Nombre completo', fPhone: 'Número de teléfono', fPhoneHint: 'Lo llamaremos o le enviaremos un texto a este número para confirmar.',
    fTime: 'Día y hora preferidos', fTimePh: 'p. ej., lunes después de las 3 p. m.', fAccident: 'Fecha del accidente', fOptional: '(opcional)',
    fAccidentHint: 'Nos ayuda a dar prioridad a las citas dentro del plazo de 14 días del PIP.',
    fConsentFallback: (name: string) => `Acepto que ${name} me llame o me envíe mensajes de texto sobre esta solicitud. Pueden aplicar tarifas de mensajes y datos.`,
    fSend: 'Enviar solicitud', fNotify: 'Avísenme', fPrefer: '¿Prefiere llamar?', fHoneypot: 'Deje este campo vacío',
    fOk: 'Gracias. Recibimos su solicitud y nuestro equipo lo llamará pronto.',
    fMissing: 'Complete los campos obligatorios: nombre, teléfono y consentimiento de contacto.',
    fSending: 'Enviando…', fFail: 'Lo sentimos, no pudimos enviar su solicitud. Por favor, llame a la oficina.',
  },
  ht: {
    pipAria: 'Rapèl sou aksidan machin',
    pipLong: 'Ou blese nan yon aksidan machin? Fè tcheke kò w anndan 14 jou.',
    pipLongSub: 'N ap resevwa w avèk oswa san referans doktè.',
    pipShort: 'Aksidan machin? Fè tcheke kò w anndan 14 jou.',
    pipShortSub: 'Ou pa bezwen referans.',
    call: 'Rele', callUs: 'Rele nou', days: 'JOU',
    requestVisit: 'Pran yon randevou', bookOnline: 'Pran randevou sou entènèt', getNotified: 'Avèti m', requestShort: 'Randevou', findLocation: 'Wè biwo yo',
    directions: 'Direksyon', newTab: '(ap louvri nan yon lòt onglè)', quickActions: 'Aksyon rapid', menu: 'Meni', language: 'Lang',
    ctaTitle: 'Ou blese nan yon aksidan machin? Fè tcheke kò w anndan 14 jou.',
    ctaBody: 'Lwa PIP Florid la jeneralman mande pou w resevwa premye swen anndan 14 jou apre aksidan an. N ap resevwa w avèk oswa san referans doktè. Rele nou oswa pran yon randevou sou entènèt.',
    howItWorks: 'Kijan sa mache', howHref: '#kijan-sa-mache',
    callNow: 'Rele kounye a', text: 'Tèks', textPrompt: 'Ou pito voye tèks?', textBody: 'Bonjou, mwen te fè yon aksidan machin e mwen ta renmen pran yon randevou.', smsNote: 'Frè mesaj ak done ka aplike. Reponn STOP pou nou pa voye mesaj ankò.',
    callOrText: 'Rele oswa voye tèks', hearIt: 'Koute l', hearAria: (v: string) => `Koute jingle ${v} la`, jingle: '/media/844-84-treat-jingle-ht.mp3',
    transcript: 'Tèks videyo a',
    videoFine: 'Pou enfòmasyon sèlman; polis ak konpayi asirans ou detèmine kouvèti a. Swen kiwopratik pa kiwopratisyen ki gen lisans nan Florid (D.C.). Moun ou wè yo se aktè, se pa pasyan.',
    mainLine: 'Liy prensipal:',
    footBlurb: 'Swen kiwopratik pou moun k ap refè apre yon aksidan machin, doulè nan kou ak nan do, ak fatig chak jou.',
    locations: 'Biwo yo', comingSoon: 'Talè konsa', followUs: 'Swiv nou',
    licensed: 'Se kiwopratisyen ki gen lisans nan Florid ki bay swen kiwopratik yo.',
    disclaimer: 'Enfòmasyon ki sou sit sa a se pou edikasyon sèlman, se pa konsèy medikal. Li l pa kreye yon relasyon doktè-pasyan. Chak blesi diferan; pale ak yon pwofesyonèl ki gen lisans sou ka pa w. Si w gen yon ijans medikal, rele 911.',
    privacy: 'Politik konfidansyalite (an anglè)', accessibility: 'Aksesibilite (an anglè)', moreEnglish: 'Tout sit la an anglè', skip: 'Ale nan kontni an',
    fTitle: 'Pran yon randevou', fNotifyTitle: (city: string) => `Avèti m lè ${city} louvri`,
    fIntro: (city: string) => `Voye demann ou epi ekip nou an nan ${city} ap rele w pou konfime lè a.`, fHours: 'Lè biwo a louvri:',
    fNotifyIntro: (name: string) => `Kite non w ak nimewo w, n ap rele w lè ${name} louvri.`,
    fPrivacy: '<strong>Tanpri pa mete</strong> detay medikal, nimewo asirans oswa nimewo reklamasyon, ni nimewo Sekirite Sosyal ou. N ap pran sa nou bezwen an prive lè w vini.',
    fName: 'Non konplè', fPhone: 'Nimewo telefòn', fPhoneHint: 'N ap rele w oswa voye yon tèks nan nimewo sa a pou konfime.',
    fTime: 'Ki jou ak ki lè ki pi bon pou ou', fTimePh: 'egz., lendi apre 3 pm', fAccident: 'Dat aksidan an', fOptional: '(si w vle)',
    fAccidentHint: 'Sa ede nou bay priyorite pou randevou ki anndan delè 14 jou PIP la.',
    fConsentFallback: (name: string) => `Mwen dakò pou ${name} rele m oswa voye tèks ban mwen sou demann sa a. Frè mesaj ak done ka aplike.`,
    fSend: 'Voye demann lan', fNotify: 'Avèti m', fPrefer: 'Ou pito rele?', fHoneypot: 'Kite espas sa a vid',
    fOk: 'Mèsi. Nou resevwa demann ou, ekip nou an ap rele w talè.',
    fMissing: 'Tanpri ranpli espas obligatwa yo: non, telefòn, ak dakò pou nou kontakte w.',
    fSending: 'N ap voye l…', fFail: 'Padon, nou pa t ka voye demann ou. Tanpri rele biwo a.',
  },
} as const;

export type UIText = (typeof UI)['en'];
export const ui = (l: Lang = 'en'): UIText => (UI[l] ?? UI.en) as unknown as UIText;

/** The attorney / auto-insurance banner: English comes from the content editor; the others are fixed here. */
export const attorneyText = (l: Lang, en: { headline: string; note: string }) =>
  l === 'es'
    ? { headline: 'Sí, trabajamos con su abogado y su seguro de auto.', note: 'Le facturamos directamente a su seguro de auto (PIP de Florida) y, con su permiso, le enviamos su expediente a su abogado. La cobertura depende de su póliza.' }
    : l === 'ht'
      ? { headline: 'Wi, nou travay ak avoka w ak asirans machin ou.', note: 'Nou voye bòdwo a dirèkteman bay asirans machin ou (PIP Florid) epi, avèk pèmisyon w, nou voye dosye w bay avoka w. Kouvèti a depann de polis ou.' }
      : en;

/** Consent line for the form: the editor's English wording, or the translated default. */
// While the English wording still waits on counsel, the translations carry the same flag.
export const consentIn = (l: Lang, english: string, name: string) =>
  l === 'en'
    ? english.replaceAll('{location}', name) || ui('en').fConsentFallback(name)
    : `${ui(l).fConsentFallback(name)}${/\[[^\]]+\]/.test(english) ? (l === 'es' ? ' [TRADUCCIÓN — CONFIRMAR CON SU ABOGADO]' : ' [TRADIKSYON — KONFIME AK AVOKA W]') : ''}`;

export const isReal = (v: string | undefined) => !!v && !isPlaceholder(v);
