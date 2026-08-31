from PIL import Image, ImageDraw, ImageFont
import os

SRC, OUT = "/tmp/ptp-portals", "/home/user/current/dist"
GOLD, BLACK, WHITE, GREY = (252,185,0), (10,10,10), (255,255,255), (140,140,140)
W_TILE, PAD, LABEL_H, HEAD = 380, 28, 40, 96

def font(sz, bold=False):
    p = f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf"
    return ImageFont.truetype(p, sz) if os.path.exists(p) else ImageFont.load_default()

def sheet(title, tabs, out):
    imgs = []
    for tab, label in tabs:
        im = Image.open(f"{SRC}/{tab}.png").convert("RGB")
        s = W_TILE / im.width
        imgs.append((label, im.resize((W_TILE, int(im.height * s)), Image.LANCZOS)))

    tall = max(i.height for _, i in imgs)
    W = len(imgs) * W_TILE + (len(imgs) + 1) * PAD
    H = HEAD + PAD + tall + LABEL_H + PAD

    sh = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(sh)
    d.rectangle([0, 0, W, HEAD], fill=BLACK)
    d.rectangle([0, HEAD - 6, W, HEAD], fill=GOLD)
    d.text((PAD, 28), title, font=font(32, True), fill=WHITE)

    for i, (label, im) in enumerate(imgs):
        x = PAD + i * (W_TILE + PAD)
        y = HEAD + PAD
        sh.paste(im, (x, y))
        d.rectangle([x - 1, y - 1, x + W_TILE, y + im.height], outline=BLACK, width=2)
        d.text((x, y + im.height + 11), label.upper(), font=font(17, True), fill=BLACK)

    sh.save(out)
    print(out, sh.size)

sheet("PARENT PORTAL",
      [("parent-home", "Home"), ("parent-schedule", "Schedule"),
       ("parent-messages", "Messages"), ("parent-account", "Account")],
      f"{OUT}/ptp-parent-portal.png")

sheet("TRAINER PORTAL",
      [("trainer-home", "Today"), ("trainer-schedule", "Schedule"),
       ("trainer-messages", "Messages"), ("trainer-pay", "Pay")],
      f"{OUT}/ptp-trainer-portal.png")
