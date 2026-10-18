# Spanish and Haitian Creole ad sets

Same concepts as the English set ("Don't Walk It Off", the jingle, the 14-day PIP rule), voiced by the same
urban voice (Fenrir) in each language, plus still images. Every voice take was scored by a native-listener
check (accent and delivery) and re-recorded until it passed. **Before buying media, have a native speaker on
staff watch each spot and read each image.** Compliance: no "free", no promises, "generally requires", and
"coverage depends on your policy" on every piece; doctor's name to be added if Florida's ad rules require it.

Landing pages: **therapyandinjury.com/es** (Spanish) and **therapyandinjury.com/ht** (Creole). Point each
language's ads at its own page.

## Files

| Piece | Spanish (es) | Haitian Creole (ht) | Sizes |
|---|---|---|---|
| Jingle / audio logo (3.8 s) | `es-1-audio-logo` | `ht-1-audio-logo` | story, square |
| Radio tag (12 s / 9.5 s) | `es-2-radio-tag` | `ht-2-radio-tag` | story, square |
| 15 s ad | `es-3-ad-15s` | `ht-3-ad-15s` | story, square, wide |
| 30 s commercial | `es-4-walk-it-off-30` "No se haga el fuerte" | `ht-4-walk-it-off-30` "Pa neglije kò w" | story, square, wide |
| Still: "Don't walk it off" | `es-walk-*` | `ht-walk-*` | square, story, link |
| Still: attorney + auto insurance | `es-attorney-*` | `ht-attorney-*` | square, story, link |

Videos: `marketing/video/out/<spot>-<story|square|wide>.mp4` (story 1080×1920 for Reels/Stories/Shorts/TikTok,
square 1080×1080 for feeds, wide 1920×1080 for YouTube). Audio-only MP3s: `marketing/jingles/out/spot-<spot>-urbanEs|urbanHt.mp3`.
Stills: `marketing/stills/out/<lang>-<walk|attorney>-<square|story|link>.jpg` (square 1080×1080, story 1080×1920,
link 1200×628). English stills are made too (`en-*`).

Rebuild: `node marketing/jingles/make-spots.mjs urban --lang es` (or `ht`), then
`node marketing/video/render.mjs urban-es` (or `urban-ht`), and `node marketing/stills/stills.mjs`.

## Spanish (Español)

**30 s script: "No se haga el fuerte"**
> Salió caminando del choque. Dijo: "Estoy bien". ¿Al día siguiente? Cuello rígido. Espalda tensa. Dolores de cabeza.
> Los síntomas pueden aparecer días después. El PIP de Florida generalmente requiere atención dentro de los 14 días.
> No se haga el fuerte. Hágase un chequeo. Atención quiropráctica, con o sin referido.
> Visite therapyandinjury.com, o llame al… *(jingle)* ocho cuatro cuatro, ocho cuatro, TREAT.

**Meta (Facebook / Instagram) ad text**
- Primary text: *¿Se lesionó en un accidente de auto? Los síntomas pueden aparecer días después, y el PIP de Florida generalmente requiere atención dentro de los 14 días. No se haga el fuerte: hágase un chequeo. Atención quiropráctica en Ocala, con o sin referido. Llame al (844) 84-TREAT · (844) 848-7328.*
- Headline: *Hágase un chequeo dentro de los 14 días*
- Attorney ad primary text: *Sí, trabajamos con su abogado y su seguro de auto. Le facturamos directamente a su seguro (PIP de Florida) y, con su permiso, le enviamos su expediente a su abogado. La cobertura depende de su póliza. Llame al (844) 84-TREAT.*
- Attorney headline: *Trabajamos con su abogado y su seguro*
- Description (both): *Atención quiropráctica · Ocala, FL*
- Button: **Llamar ahora** (Call Now) or **Más información** (Learn More) → therapyandinjury.com/es

**YouTube**
- Title: *No se haga el fuerte | ¿Accidente de auto? Hágase un chequeo dentro de 14 días | Therapy & Injury*
- Description: *Salió caminando del choque y dijo "estoy bien". Al día siguiente: cuello rígido, espalda tensa, dolores de cabeza. Los síntomas pueden aparecer días después, y el PIP de Florida generalmente requiere atención dentro de los 14 días. No se haga el fuerte. Llame al (844) 84-TREAT · (844) 848-7328. https://therapyandinjury.com/es — Atención quiropráctica por quiroprácticos con licencia en Florida. Si tiene una emergencia, llame al 911. Este video es educativo y no es consejo médico.*
- Hashtags: *#AccidenteDeAuto #Quiropráctico #OcalaFL #PIPFlorida #NoSeHagaElFuerte #844TREAT*
- Tags: *quiropráctico ocala, quiropráctico para accidentes de auto, accidente de auto florida, pip florida 14 días, dolor de cuello después de un accidente, latigazo cervical, therapy and injury, 844 84 treat*

## Haitian Creole (Kreyòl ayisyen)

**30 s script: "Pa neglije kò w"**
> Ou soti nan aksidan an sou de pye w. Ou di: "Mwen anfòm." Nan demen maten? Kou fè w mal. Do fè w mal. Tèt fè w mal.
> Sentòm yo ka parèt kèk jou apre. Lwa PIP Florid la jeneralman mande swen anndan 14 jou.
> Pa neglije kò w. Al fè tcheke kò w. Swen kiwopratik, avèk oswa san referans doktè.
> Vizite therapyandinjury.com, oswa rele… *(jingle)* uit kat kat, uit kat, TREAT.

**Meta (Facebook / Instagram) ad text**
- Primary text: *Ou blese nan yon aksidan machin? Sentòm yo ka parèt kèk jou apre, epi lwa PIP Florid la jeneralman mande swen anndan 14 jou. Pa neglije kò w: al fè tcheke kò w. Swen kiwopratik nan Ocala, avèk oswa san referans doktè. Rele (844) 84-TREAT · (844) 848-7328.*
- Headline: *Fè tcheke kò w anndan 14 jou*
- Attorney ad primary text: *Wi, nou travay ak avoka w ak asirans machin ou. Nou voye bòdwo a dirèkteman bay asirans ou (PIP Florid) epi, avèk pèmisyon w, nou voye dosye w bay avoka w. Kouvèti a depann de polis ou. Rele (844) 84-TREAT.*
- Attorney headline: *Nou travay ak avoka w ak asirans ou*
- Description (both): *Swen kiwopratik · Ocala, FL*
- Button: **Rele kounye a** (Call Now) or **Plis enfòmasyon** (Learn More) → therapyandinjury.com/ht

**YouTube**
- Title: *Pa neglije kò w | Aksidan machin? Fè tcheke kò w anndan 14 jou | Therapy & Injury*
- Description: *Ou soti nan aksidan an sou de pye w epi ou di "mwen anfòm". Nan demen maten: kou fè w mal, do fè w mal, tèt fè w mal. Sentòm yo ka parèt kèk jou apre, epi lwa PIP Florid la jeneralman mande swen anndan 14 jou. Pa neglije kò w. Rele (844) 84-TREAT · (844) 848-7328. https://therapyandinjury.com/ht — Swen kiwopratik pa kiwopratisyen ki gen lisans nan Florid. Si w gen yon ijans, rele 911. Videyo sa a se pou edikasyon, se pa konsèy medikal.*
- Hashtags: *#AksidanMachin #Kiwopratik #OcalaFL #PIPFlorid #PaNeglijeKòW #844TREAT*
- Tags: *kiwopratisyen ocala, aksidan machin florid, pip florid 14 jou, doulè nan kou apre aksidan, therapy and injury, 844 84 treat, haitian chiropractor florida*

## Targeting notes (Meta)
- Language targeting: Spanish (all) for the Spanish set. For Creole, pick **Haitian Creole** under Languages if Ads Manager offers it; if not, use French plus interests related to Haiti within the radius. Many Haitian Floridians use English or French on Facebook, so run the Creole ads alongside the English ones, not instead of them.
- Location: a radius around each open office (no health-condition targeting; Meta restricts it).
- Special ad category: none needed for chiropractic care (it's not housing, credit, employment or politics).
