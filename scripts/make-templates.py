# Generates the built-in slide templates in src/templates. Edit and run: python3 scripts/make-templates.py
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'templates')
T = [
 dict(id='folio', name='Folio', desc='Quiet greys and a clear hierarchy. Works for almost anything.', tags='neutral, light, minimal', theme='folio',
      tok=dict(paper='#fcfcfc', ink='#1f1f1f', muted='#6b6b6b', accent='#1f1f1f', card='#f2f2f2'), hf='Inter', bf='Inter',
      decor='::: line #rule x=88 y=180 w=1104 h=0 stroke=#d9d9d9 width=1.5 :::',
      title_bg='', title_decor='::: box #tag x=88 y=600 w=600 h=40 size=18 color=#6b6b6b\nCompany · Date\n:::', sec_bg='_backgroundColor: #1f1f1f', sec_color='#fcfcfc',
      variants={'Ink': '#ffffff,#000000,#555555,#000000,#f0f0f0', 'Stone': '#f4f2ee,#262421,#6e6a63,#8a5a2b,#e9e5de'}),
 dict(id='graphite', name='Graphite', desc='Dark slides with bright type, for keynotes and demos.', tags='dark, keynote', theme='graphite',
      tok=dict(paper='#161616', ink='#f5f5f5', muted='#a3a3a3', accent='#ffffff', card='#242424'), hf='Inter', bf='Inter',
      decor='::: box #dot x=1160 y=640 w=32 h=32 fill=#f5f5f5 radius=16\n:::',
      title_bg='_backgroundImage: linear-gradient(135deg, #161616, #2e2e2e)', title_decor='', sec_bg='_backgroundColor: #f5f5f5', sec_color='#161616',
      variants={'Midnight': '#0e1525,#eef2ff,#9aa4bf,#7aa2ff,#1a2338', 'Coal': '#111111,#f0ede6,#a29e94,#e0b15b,#1f1e1c'}),
 dict(id='editorial', name='Editorial', desc='Serif headings on warm paper, for reports, essays and reviews.', tags='serif, report, light', theme='paper',
      tok=dict(paper='#f6f1e7', ink='#24201a', muted='#6f6658', accent='#8a3b12', card='#ece4d4'), hf='Georgia', bf='Georgia',
      decor='::: box #folio x=88 y=650 w=500 h=36 size=16 color=#6f6658 font=serif\nThe Review · Issue 1\n:::',
      title_bg='', title_decor='::: line #rule x=88 y=450 w=180 h=0 stroke=#8a3b12 width=3 :::', sec_bg='_backgroundColor: #24201a', sec_color='#f6f1e7',
      variants={'Ivory': '#fbf8f1,#1d1b16,#6b665b,#1f4e79,#f0eadb', 'Sage': '#eef0e8,#1f241d,#5f6a5a,#3c6e47,#e0e5d8'}),
 dict(id='swiss', name='Swiss', desc='Big bold type, a red accent and a strict grid.', tags='bold, grid, pitch', theme='folio',
      tok=dict(paper='#ffffff', ink='#111111', muted='#5c5c5c', accent='#e3120b', card='#f1f1f1'), hf='Helvetica Neue', bf='Helvetica Neue',
      decor='::: box #bar x=0 y=0 w=24 h=720 fill=#e3120b\n:::',
      title_bg='', title_decor='::: box #block x=880 y=0 w=400 h=720 fill=#e3120b\n:::', sec_bg='_backgroundColor: #e3120b', sec_color='#ffffff',
      variants={'Blue': '#ffffff,#111111,#5c5c5c,#0047bb,#f1f1f1', 'Black': '#ffffff,#111111,#5c5c5c,#111111,#f1f1f1'}),
 dict(id='corporate', name='Corporate', desc='Navy and white with a footer bar, for company updates and client decks.', tags='business, light', theme='folio',
      tok=dict(paper='#ffffff', ink='#1b2a3d', muted='#5d6b7c', accent='#1f4f8b', card='#eef2f7'), hf='Arial', bf='Arial',
      decor='::: box #footer x=0 y=676 w=1280 h=44 fill=#1f4f8b\n:::\n\n::: box #footer-text x=88 y=682 w=700 h=32 size=16 color=#ffffff valign=middle\nCompany name · Confidential\n:::',
      title_bg='_backgroundColor: #1f4f8b', title_decor='', sec_bg='_backgroundColor: #eef2f7', sec_color='#1b2a3d', title_color='#ffffff',
      variants={'Teal': '#ffffff,#13302e,#56706d,#0f766e,#e9f4f2', 'Plum': '#ffffff,#2b1a33,#6c5a73,#6b2d7a,#f3ecf5'}),
 dict(id='studio', name='Studio', desc='Soft gradients and rounded cards, for workshops and product stories.', tags='gradient, friendly', theme='folio',
      tok=dict(paper='#fbf7f4', ink='#2a2522', muted='#7a716b', accent='#d9572b', card='#ffffff'), hf='Avenir Next', bf='Avenir Next',
      decor='::: shape #blob type=ellipse x=1030 y=-120 w=360 h=360 fill=linear(#ffd7c2,#fbf7f4,135) border=0\n\n\n:::',
      title_bg='_backgroundImage: linear-gradient(135deg, #ffe3d3, #fbf7f4)', title_decor='', sec_bg='_backgroundImage: linear-gradient(135deg, #d9572b, #f2a65a)', sec_color='#ffffff',
      variants={'Lagoon': '#f3f8f8,#1d2a2b,#667778,#0e8a8a,#ffffff', 'Lilac': '#f7f5fb,#26222f,#736c80,#7552c7,#ffffff'}),
 dict(id='mono', name='Mono', desc='Monospaced type, black and white, for engineering and technical talks.', tags='technical, code, minimal', theme='folio',
      tok=dict(paper='#ffffff', ink='#000000', muted='#555555', accent='#000000', card='#f3f3f3'), hf='Courier New', bf='Courier New',
      decor='::: box #path x=88 y=650 w=700 h=36 size=16 color=#555555 font=mono\n~/talk/slides\n:::',
      title_bg='_backgroundColor: #000000', title_decor='', sec_bg='_backgroundColor: #000000', sec_color='#ffffff', title_color='#ffffff',
      variants={'Terminal': '#0b0f0b,#d7f5d7,#7fa37f,#4ade80,#141a14', 'Paper': '#fbfaf6,#1a1a1a,#666666,#1a1a1a,#f0eee7'}),
 dict(id='pitch', name='Pitch', desc='Huge titles and an orange accent, for investor and sales pitches.', tags='pitch, bold, startup', theme='folio',
      tok=dict(paper='#fffaf5', ink='#1c1917', muted='#78716c', accent='#ff5a1f', card='#fff1e6'), hf='Futura', bf='Avenir Next',
      decor='::: box #mark x=1168 y=56 w=24 h=24 fill=#ff5a1f radius=12\n:::',
      title_bg='_backgroundColor: #ff5a1f', title_decor='', sec_bg='_backgroundColor: #1c1917', sec_color='#fffaf5', title_color='#ffffff',
      variants={'Lime': '#fbfdf5,#1a1f12,#6b7360,#65a30d,#f0f7e4', 'Electric': '#f7f8ff,#121433,#636a8c,#4338ca,#e9ebff'}),
]
def fm(t):
    lines = ['---', 'marp: true', f"template-name: {t['name']}", f"template-description: {t['desc']}", f"template-tags: {t['tags']}", f"theme: {t['theme']}"]
    lines += [f'{k}: "{v}"' for k, v in t['tok'].items()]
    lines += [f"heading-font: {t['hf']}", f"body-font: {t['bf']}", 'paginate: true']
    lines += [f'variant-{k.lower()}: "{v}"' for k, v in t['variants'].items()]
    return '\n'.join(lines + ['---', ''])
def deck(t):
    ink = t['tok']['ink']; muted = t['tok']['muted']; tc = t.get('title_color', ink)
    hfont = '' if t['hf'] == t['bf'] else ''
    parts = []
    parts.append(f"""<!-- master -->
## Master: all slides

::: box placeholder=title x=88 y=64 w=1104 h=104 size=46 valign=bottom
## Slide title
:::

::: box placeholder=body x=88 y=204 w=1104 h=420 size=28
- First level
  - Second level
:::

{t['decor']}
""")
    parts.append(f"""<!-- master: title only -->
{('<!-- ' + t['title_bg'] + ' -->') if t['title_bg'] else ''}
## Master: title slides

::: box placeholder=title x=88 y=210 w=760 h=220 size=68 valign=bottom color={tc}
# Presentation title
:::

::: box placeholder=subtitle x=88 y=460 w=760 h=120 size=26 color={tc if t.get('title_color') else muted}
Subtitle or speaker
:::

{t['title_decor']}
""")
    parts.append(f"""<!-- master: section only -->
<!-- {t['sec_bg']} -->
## Master: section slides

::: box placeholder=title x=88 y=260 w=1104 h=200 size=60 valign=middle color={t['sec_color']}
# Section name
:::
""")
    parts.append(f"""<!-- layout: title -->
# {t['name']} template

Replace with your subtitle
""")
    parts.append("""## What this template gives you

- Colours, fonts and a background for every slide
- A master with a title and a body placeholder
- Title and section layouts with their own design
""")
    parts.append("""<!-- layout: section -->
# Next section
""")
    parts.append("""<!-- layout: two-columns -->
## Two columns

::: left
### Left
- Point
:::

::: right
### Right
- Point
:::
""")
    return fm(t) + '\n' + '\n---\n\n'.join(p.strip('\n') + '\n' for p in parts)
for t in T:
    with open(os.path.join(OUT, f"{t['name']}.slides.md"), 'w') as f: f.write(deck(t))
print(len(T), 'templates')
