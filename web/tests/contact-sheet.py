from PIL import Image, ImageDraw, ImageFont
import os, glob, math

SRC = "/tmp/ptp-shots"
OUT = "/home/user/current/dist"
os.makedirs(OUT, exist_ok=True)

GOLD, BLACK, WHITE, GREY = (252,185,0), (10,10,10), (255,255,255), (140,140,140)
THUMB_W, THUMB_H = 300, 460          # each page, cropped to a consistent tile
PAD, LABEL_H, COLS = 24, 34, 4

def font(sz, bold=False):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
              else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()

files = sorted(glob.glob(f"{SRC}/*.png"))
PER_SHEET = 12

for sheet_no, start in enumerate(range(0, len(files), PER_SHEET), start=1):
    batch = files[start:start+PER_SHEET]
    rows = math.ceil(len(batch)/COLS)
    W = COLS*THUMB_W + (COLS+1)*PAD
    HEAD = 92
    H = HEAD + rows*(THUMB_H+LABEL_H+PAD) + PAD

    sheet = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(sheet)

    d.rectangle([0,0,W,HEAD], fill=BLACK)
    d.rectangle([0,HEAD-6,W,HEAD], fill=GOLD)
    d.text((PAD, 26), "PTP — EVERY PAGE", font=font(30, True), fill=WHITE)
    d.text((W-PAD-190, 34), f"sheet {sheet_no} of {math.ceil(len(files)/PER_SHEET)}",
           font=font(18), fill=GOLD)

    for i, f in enumerate(batch):
        col, row = i % COLS, i // COLS
        x = PAD + col*(THUMB_W+PAD)
        y = HEAD + PAD + row*(THUMB_H+LABEL_H+PAD)

        img = Image.open(f).convert("RGB")
        # Scale to width, then crop the top — a full-page shot of a long page
        # squashed to a tile shows nothing.
        scale = THUMB_W / img.width
        img = img.resize((THUMB_W, max(1, int(img.height*scale))), Image.LANCZOS)
        tile = Image.new("RGB", (THUMB_W, THUMB_H), WHITE)
        tile.paste(img.crop((0, 0, THUMB_W, min(THUMB_H, img.height))), (0, 0))

        sheet.paste(tile, (x, y))
        d.rectangle([x-1, y-1, x+THUMB_W, y+THUMB_H], outline=BLACK, width=2)

        name = os.path.basename(f).replace(".png","").split("-",1)[1].replace("-"," ")
        d.text((x, y+THUMB_H+9), name.upper(), font=font(15, True), fill=BLACK)
        if img.height > THUMB_H:
            d.text((x+THUMB_W-46, y+THUMB_H+9), "more", font=font(13), fill=GREY)

    sheet.save(f"{OUT}/ptp-pages-{sheet_no}.png")
    print(f"{OUT}/ptp-pages-{sheet_no}.png  {sheet.size[0]}x{sheet.size[1]}")
