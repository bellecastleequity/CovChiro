# Ad links that report their source (UTM tags)

Every ad should link to the site with tags, so each lead in **/_admin → Leads** shows the campaign and the
**Reports** tab can work out cost per lead and per new patient. The site reads the tags itself; nothing is
sent to Meta or Google. Tags never contain personal details.

| Tag | Meaning | Our values |
|---|---|---|
| `utm_source` | where the ad ran | `facebook`, `instagram`, `youtube`, `google`, `radio`, `print` |
| `utm_medium` | type of placement | `paid_social`, `cpc` (Google search ads), `video`, `display`, `radio`, `qr` |
| `utm_campaign` | the campaign (enter ad spend under this exact name) | see below |
| `utm_content` | which ad | e.g. `video30-story`, `still-square-attorney` |

## Campaign names

| Campaign | `utm_campaign` | Landing page |
|---|---|---|
| Don't Walk It Off (English) | `en-walk-it-off` | `https://therapyandinjury.com/` (or `/ocala/`) |
| No se haga el fuerte (Spanish) | `es-no-se-haga-el-fuerte` | `https://therapyandinjury.com/es/` |
| Pa neglije kò w (Creole) | `ht-pa-neglije-ko-w` | `https://therapyandinjury.com/ht/` |
| Attorney + auto insurance (English) | `en-attorney` | `https://therapyandinjury.com/ocala/` |
| Attorney + auto insurance (Spanish) | `es-attorney` | `https://therapyandinjury.com/es/` |
| Attorney + auto insurance (Creole) | `ht-attorney` | `https://therapyandinjury.com/ht/` |
| 844-84-TREAT jingle / radio tag | `jingle` | `https://therapyandinjury.com/` |

## Meta (Facebook / Instagram): easiest way

In Ads Manager, open the ad → **Destination** → Website URL: the landing page above. Then, under
**Tracking → URL parameters**, paste this once per ad (Meta fills in the names itself):

```
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}
```

Name each **campaign** in Ads Manager exactly as in the table (e.g. `es-no-se-haga-el-fuerte`) and each
**ad** after the file (e.g. `video30-story`). `{{site_source_name}}` becomes `fb` or `ig`; the Reports group
both under "Meta ads".

## Ready-made links

Spanish 30 s video, Instagram/Facebook feed:
`https://therapyandinjury.com/es/?utm_source=facebook&utm_medium=paid_social&utm_campaign=es-no-se-haga-el-fuerte&utm_content=video30-square`

Spanish attorney still, Stories:
`https://therapyandinjury.com/es/?utm_source=instagram&utm_medium=paid_social&utm_campaign=es-attorney&utm_content=still-story`

Creole 30 s video, Reels/Stories:
`https://therapyandinjury.com/ht/?utm_source=instagram&utm_medium=paid_social&utm_campaign=ht-pa-neglije-ko-w&utm_content=video30-story`

Creole attorney still, feed:
`https://therapyandinjury.com/ht/?utm_source=facebook&utm_medium=paid_social&utm_campaign=ht-attorney&utm_content=still-square`

English 60 s commercial, YouTube:
`https://therapyandinjury.com/?utm_source=youtube&utm_medium=video&utm_campaign=en-walk-it-off&utm_content=video60-wide`

English 30 s video, Facebook feed:
`https://therapyandinjury.com/ocala/?utm_source=facebook&utm_medium=paid_social&utm_campaign=en-walk-it-off&utm_content=video30-square`

English attorney still, Facebook link ad:
`https://therapyandinjury.com/ocala/?utm_source=facebook&utm_medium=paid_social&utm_campaign=en-attorney&utm_content=still-link`

YouTube video description link (organic, not an ad):
`https://therapyandinjury.com/?utm_source=youtube&utm_medium=organic&utm_campaign=en-walk-it-off&utm_content=description`

Radio / print / flyers (a short link people can type, or a QR code):
`https://therapyandinjury.com/?utm_source=radio&utm_medium=radio&utm_campaign=jingle`
`https://therapyandinjury.com/?utm_source=print&utm_medium=qr&utm_campaign=en-walk-it-off&utm_content=flyer`

## Google Ads
Turn on **auto-tagging** (Google adds `gclid`, and the Reports show "Google ads"). To also see the campaign
name, set each campaign's **Final URL suffix** (Campaign settings → Campaign URL options) to
`utm_source=google&utm_medium=cpc&utm_campaign=en-walk-it-off` (with that campaign's name from the table).

## Phone calls
Most people call instead of filling in the form. The website counts **call-button taps** by campaign
(anonymously), and the front desk logs each caller with **+ Phone lead → How did you hear about us?**.
Ask every new caller.
