# Frame-removal spike (#100), step 2: for each fixture, the segmenter's classes
# inside a landmark-built lens region, the landmark glasses mask, classic
# inpainting (Telea, Navier-Stokes) of it, and a thin-rim removal test with
# ground truth (a 4 px bar drawn over skin and hair, then inpainted).
#
#   python3 analyze.py <seg.json> <faces-dir> <out-dir>   (needs numpy, opencv-python-headless)
import json, sys, time
import numpy as np, cv2
SEG, FACES, OUT = sys.argv[1:4]
seg = json.load(open(SEG))
LABELS = seg['labels']
L_EYE = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246]
R_EYE = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398]

def px(lm, i, w, h): return np.array([lm[i][0]*w, lm[i][1]*h])

def glasses_mask(lm, w, h):
    m = np.zeros((h, w), np.uint8)
    lenses = []
    for eye, inner, outer, ear in ((L_EYE, 133, 33, 234), (R_EYE, 362, 263, 454)):
        pts = np.array([px(lm, i, w, h) for i in eye])
        a, b = px(lm, inner, w, h), px(lm, outer, w, h)
        ew = np.linalg.norm(b - a)
        ang = np.degrees(np.arctan2(b[1]-a[1], b[0]-a[0]))
        c = pts.mean(0) + np.array([0, 0.1*ew])
        lens = np.zeros_like(m)
        cv2.ellipse(lens, (int(c[0]), int(c[1])), (int(0.95*ew), int(0.72*ew)), ang, 0, 360, 255, -1)
        lenses.append(lens)
        m |= lens
        # temple: from the lens's outer edge to the ear landmark
        edge = c + (b - a) / ew * 0.95 * ew
        cv2.line(m, tuple(int(v) for v in edge), tuple(int(v) for v in px(lm, ear, w, h)), 255, max(3, int(0.14*ew)))
    # bridge between the inner corners, at the top of the nose
    cv2.line(m, tuple(int(v) for v in px(lm, 133, w, h)), tuple(int(v) for v in px(lm, 362, w, h)), 255, max(3, int(0.12*np.linalg.norm(px(lm,133,w,h)-px(lm,362,w,h)))))
    return m, lenses[0] | lenses[1]

def psnr(a, b, mask):
    d = (a.astype(float) - b.astype(float))[mask > 0]
    mse = (d**2).mean()
    return 10*np.log10(255**2/mse), np.abs(d).mean()

rows, report = [], {}
for name in ['iris-moss', 'pteron-azure', 'kairos-amber']:
    img = cv2.imread(f'{FACES}/{name}.jpg'); h, w = img.shape[:2]
    lm = seg[name]['lm']
    mask, lens = glasses_mask(lm, w, h)
    s = seg[name]
    cat = cv2.resize(np.array(s['cat'], np.uint8).reshape(s['h'], s['w']), (w, h), interpolation=cv2.INTER_NEAREST)
    acc = cv2.resize(np.array(s['acc'], np.uint8).reshape(s['h'], s['w']), (w, h))
    inside = cat[lens > 0]
    shares = {LABELS[k]: round(float((inside == k).mean()*100), 1) for k in range(len(LABELS))}
    others_iou = float(((cat == 5) & (mask > 0)).sum() / max(1, ((cat == 5) | (mask > 0)).sum()))
    res = {}
    for label, flag in (('telea', cv2.INPAINT_TELEA), ('ns', cv2.INPAINT_NS)):
        t = []
        for _ in range(5):
            t0 = time.perf_counter(); out = cv2.inpaint(img, mask, 5, flag); t.append((time.perf_counter()-t0)*1000)
        res[label] = (out, min(t))
    # Thin-rim test: a 4 px frame-coloured bar across the forehead and one
    # across the temple hair, removed again; scored against the original.
    rim = np.zeros((h, w), np.uint8)
    brow = [px(lm, i, w, h) - np.array([0, 0.35*np.linalg.norm(px(lm,33,w,h)-px(lm,133,w,h))]) for i in (70, 105, 107, 9, 336, 334, 300)]
    cv2.polylines(rim, [np.array(brow, np.int32)], False, 255, 4)
    cv2.line(rim, tuple(int(v) for v in px(lm, 46, w, h)), tuple(int(v) for v in px(lm, 234, w, h)), 255, 4)
    cv2.line(rim, tuple(int(v) for v in px(lm, 276, w, h)), tuple(int(v) for v in px(lm, 454, w, h)), 255, 4)
    drawn = img.copy(); drawn[rim > 0] = (30, 38, 48)
    region = cv2.dilate(rim, np.ones((3, 3), np.uint8))
    thin = {}
    for label, flag in (('telea', cv2.INPAINT_TELEA), ('ns', cv2.INPAINT_NS)):
        t0 = time.perf_counter(); fixed = cv2.inpaint(drawn, region, 3, flag); ms = (time.perf_counter()-t0)*1000
        thin[label] = (fixed, ms, *psnr(fixed, img, region))
    blur = cv2.GaussianBlur(drawn, (0, 0), 3); blurfix = drawn.copy(); blurfix[region > 0] = blur[region > 0]
    report[name] = {
        'lensClassShares': shares, 'othersIoUvsLandmarkMask': round(others_iou, 3),
        'maskPx': int((mask > 0).sum()), 'maskPctOfFrame': round(float((mask > 0).mean()*100), 1),
        'inpaintMs': {k: round(v[1], 1) for k, v in res.items()},
        'thinRim': {k: {'ms': round(v[1], 2), 'psnr': round(v[2], 1), 'mae': round(v[3], 1)} for k, v in thin.items()},
        'thinRimDrawnPsnr': round(psnr(drawn, img, region)[0], 1),
        'segmentMs': round(float(np.median(s['ms'])), 0)
    }
    over = img.copy(); over[mask > 0] = (0.5*over[mask > 0] + 0.5*np.array([0, 0, 255])).astype(np.uint8)
    accv = img.copy(); accv[:, :, 1] = np.maximum(accv[:, :, 1], acc)
    rows.append(np.hstack([img, accv, over, res['telea'][0], res['ns'][0]]))
    rows.append(np.hstack([drawn, thin['telea'][0], thin['ns'][0], blurfix, img]))
sheet = np.vstack(rows)
cv2.imwrite(f'{OUT}/sheet.jpg', cv2.resize(sheet, None, fx=0.5, fy=0.5), [cv2.IMWRITE_JPEG_QUALITY, 85])
json.dump(report, open(f'{OUT}/report.json', 'w'), indent=1)
print(json.dumps(report, indent=1))
