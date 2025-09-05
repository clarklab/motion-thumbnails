let encoder = null;
let frameCount = 0;
let processedFrames = 0;

self.onmessage = function(e) {
    const { type } = e.data;
    
    switch(type) {
        case 'init':
            initEncoder(e.data);
            break;
        case 'frame':
            addFrame(e.data);
            break;
        case 'finish':
            finishEncoding();
            break;
    }
};

function initEncoder({ width, height, frameCount: total, frameDuration }) {
    try {
        frameCount = total;
        processedFrames = 0;
        
        encoder = new GIFEncoder();
        encoder.setRepeat(0);
        encoder.setDelay(frameDuration);
        encoder.setSize(width, height);
        encoder.setQuality(5); // Better quality (1-30, lower = better)
        encoder.setTransparent(null);
        encoder.start();
        
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
}

function addFrame({ frameIndex, imageData }) {
    try {
        encoder.addFrame(imageData.data, true);
        processedFrames++;
        
        const progress = Math.round((processedFrames / frameCount) * 100);
        self.postMessage({ type: 'progress', progress });
        
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
}

function finishEncoding() {
    try {
        encoder.finish();
        const buffer = encoder.stream().getData();
        const blob = new Blob([buffer], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);
        
        self.postMessage({ type: 'complete', url });
        
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
}

class GIFEncoder {
    constructor() {
        this.width = 0;
        this.height = 0;
        this.delay = 100;
        this.repeat = 0;
        this.quality = 10;
        this.frames = [];
        this.out = new ByteArray();
    }
    
    setSize(w, h) {
        this.width = w;
        this.height = h;
    }
    
    setDelay(ms) {
        this.delay = Math.round(ms / 10);
    }
    
    setRepeat(n) {
        this.repeat = n;
    }
    
    setQuality(q) {
        this.quality = Math.max(1, Math.min(30, q));
    }
    
    start() {
        this.out = new ByteArray();
        this.writeHeader();
        this.writeLogicalScreenDescriptor();
        this.writeApplicationExtension();
    }
    
    addFrame(imageData, useWebWorker) {
        const pixels = this.getPixels(imageData);
        const indexedPixels = this.quantize(pixels);
        this.writeGraphicControlExtension();
        this.writeImageDescriptor();
        this.writePixels(indexedPixels);
    }
    
    finish() {
        this.out.writeByte(0x3b);
    }
    
    stream() {
        return this.out;
    }
    
    writeHeader() {
        this.out.writeString("GIF89a");
    }
    
    writeLogicalScreenDescriptor() {
        this.out.writeShort(this.width);
        this.out.writeShort(this.height);
        this.out.writeByte(0x80 | 0x70 | 0x00 | 7);
        this.out.writeByte(0);
        this.out.writeByte(0);
        
        for (let i = 0; i < 256; i++) {
            const v = (i * 255 / 255) | 0;
            this.out.writeByte(v);
            this.out.writeByte(v);
            this.out.writeByte(v);
        }
    }
    
    writeApplicationExtension() {
        this.out.writeByte(0x21);
        this.out.writeByte(0xff);
        this.out.writeByte(11);
        this.out.writeString("NETSCAPE2.0");
        this.out.writeByte(3);
        this.out.writeByte(1);
        this.out.writeShort(this.repeat);
        this.out.writeByte(0);
    }
    
    writeGraphicControlExtension() {
        this.out.writeByte(0x21);
        this.out.writeByte(0xf9);
        this.out.writeByte(4);
        this.out.writeByte(0);
        this.out.writeShort(this.delay);
        this.out.writeByte(0);
        this.out.writeByte(0);
    }
    
    writeImageDescriptor() {
        this.out.writeByte(0x2c);
        this.out.writeShort(0);
        this.out.writeShort(0);
        this.out.writeShort(this.width);
        this.out.writeShort(this.height);
        this.out.writeByte(0x80 | 7);
    }
    
    writePixels(indexedPixels) {
        const encoder = new LZWEncoder(this.width, this.height, indexedPixels, 8);
        encoder.encode(this.out);
    }
    
    getPixels(imageData) {
        const pixels = [];
        const data = imageData;
        
        for (let i = 0; i < data.length; i += 4) {
            pixels.push(data[i]);
            pixels.push(data[i + 1]);
            pixels.push(data[i + 2]);
        }
        
        return pixels;
    }
    
    quantize(pixels) {
        const nq = new NeuQuant(pixels, this.quality);
        const palette = nq.process();
        
        const indexedPixels = new Uint8Array(this.width * this.height);
        let k = 0;
        
        for (let j = 0; j < this.height; j++) {
            for (let i = 0; i < this.width; i++) {
                const index = j * this.width + i;
                const r = pixels[index * 3];
                const g = pixels[index * 3 + 1];
                const b = pixels[index * 3 + 2];
                indexedPixels[k++] = nq.map(r, g, b);
            }
        }
        
        for (let i = 0; i < 256; i++) {
            const o = i * 3;
            const r = palette[o];
            const g = palette[o + 1];
            const b = palette[o + 2];
        }
        
        return indexedPixels;
    }
}

class ByteArray {
    constructor() {
        this.data = [];
    }
    
    writeByte(val) {
        this.data.push(val);
    }
    
    writeShort(val) {
        this.writeByte(val & 0xff);
        this.writeByte((val >> 8) & 0xff);
    }
    
    writeString(s) {
        for (let i = 0; i < s.length; i++) {
            this.writeByte(s.charCodeAt(i));
        }
    }
    
    getData() {
        return new Uint8Array(this.data);
    }
}

class LZWEncoder {
    constructor(width, height, pixels, colorDepth) {
        this.width = width;
        this.height = height;
        this.pixels = pixels;
        this.initCodeSize = Math.max(2, colorDepth);
    }
    
    encode(out) {
        out.writeByte(this.initCodeSize);
        
        const remaining = this.pixels.length;
        let curPixel = 0;
        
        const compress = (initCodeSize) => {
            const hsize = 5003;
            const maxcode = (n_bits) => (1 << n_bits) - 1;
            
            let fcode, c, ent, disp, hshift;
            let n_bits = initCodeSize + 1;
            let code_size = 1 << initCodeSize;
            let clear_code = code_size;
            let eof_code = clear_code + 1;
            let free_ent = clear_code + 2;
            let a_count = 0;
            let cur_accum = 0;
            let cur_bits = 0;
            let ClearCode = clear_code;
            const g_init_bits = initCodeSize;
            let maxmaxcode = 1 << 12;
            
            const htab = new Int32Array(hsize);
            const codetab = new Int32Array(hsize);
            const accum = [];
            
            let remaining = this.pixels.length;
            let curPixel = 0;
            
            const char_out = (c, outs) => {
                accum[a_count++] = c;
                if (a_count >= 254) flush_char(outs);
            };
            
            const flush_char = (outs) => {
                if (a_count > 0) {
                    outs.writeByte(a_count);
                    for (let i = 0; i < a_count; i++) {
                        outs.writeByte(accum[i]);
                    }
                    a_count = 0;
                }
            };
            
            const output = (code) => {
                cur_accum &= (1 << cur_bits) - 1;
                cur_accum |= (code << cur_bits);
                cur_bits += n_bits;
                
                while (cur_bits >= 8) {
                    char_out(cur_accum & 0xff, out);
                    cur_accum >>= 8;
                    cur_bits -= 8;
                }
                
                if (free_ent > maxcode(n_bits) || clear_flg) {
                    if (clear_flg) {
                        n_bits = g_init_bits + 1;
                        clear_flg = false;
                    } else {
                        ++n_bits;
                        if (n_bits == 12) maxcode = maxmaxcode;
                        else maxcode = maxcode(n_bits);
                    }
                }
                
                if (code == eof_code) {
                    while (cur_bits > 0) {
                        char_out(cur_accum & 0xff, out);
                        cur_accum >>= 8;
                        cur_bits -= 8;
                    }
                    flush_char(out);
                }
            };
            
            for (let i = 0; i < hsize; i++) htab[i] = -1;
            
            let clear_flg = false;
            ent = this.pixels[curPixel++];
            
            hshift = 0;
            for (fcode = hsize; fcode < 65536; fcode *= 2) ++hshift;
            hshift = 8 - hshift;
            
            output(clear_code);
            
            outer_loop: while (curPixel < remaining) {
                c = this.pixels[curPixel++];
                fcode = (c << 12) + ent;
                let i = (c << hshift) ^ ent;
                
                if (htab[i] === fcode) {
                    ent = codetab[i];
                    continue;
                } else if (htab[i] >= 0) {
                    disp = hsize - i;
                    if (i === 0) disp = 1;
                    
                    do {
                        if ((i -= disp) < 0) i += hsize;
                        if (htab[i] === fcode) {
                            ent = codetab[i];
                            continue outer_loop;
                        }
                    } while (htab[i] >= 0);
                }
                
                output(ent);
                ent = c;
                
                if (free_ent < 1 << 12) {
                    codetab[i] = free_ent++;
                    htab[i] = fcode;
                } else {
                    for (let i = 0; i < hsize; i++) htab[i] = -1;
                    free_ent = clear_code + 2;
                    clear_flg = true;
                    output(clear_code);
                }
            }
            
            output(ent);
            output(eof_code);
        };
        
        compress.call(this, this.initCodeSize);
        out.writeByte(0);
    }
}

class NeuQuant {
    constructor(pixels, sampleFac) {
        this.pixels = pixels;
        this.sampleFac = sampleFac;
        this.netsize = 256;
        this.specials = 3;
        this.bgColor = this.specials - 1;
        this.cutnetsize = this.netsize - this.specials;
        this.maxnetpos = this.netsize - 1;
        
        this.initrad = this.netsize >> 3;
        this.radiusbiasshift = 6;
        this.radiusbias = 1 << this.radiusbiasshift;
        this.initBiasRadius = this.initrad * this.radiusbias;
        this.radiusdec = 30;
        
        this.alphabiasshift = 10;
        this.initalpha = 1 << this.alphabiasshift;
        this.alphadec = 1;
        
        this.radbiasshift = 8;
        this.radbias = 1 << this.radbiasshift;
        this.alpharadbshift = this.alphabiasshift + this.radbiasshift;
        this.alpharadbias = 1 << this.alpharadbshift;
        
        this.prime1 = 499;
        this.prime2 = 491;
        this.prime3 = 487;
        this.prime4 = 503;
        this.maxprime = this.prime4;
        
        this.network = [];
        this.netindex = new Int32Array(256);
        this.bias = new Int32Array(this.netsize);
        this.freq = new Int32Array(this.netsize);
        this.radpower = new Int32Array(this.netsize >> 3);
    }
    
    process() {
        this.setUpArrays();
        this.learn();
        this.fix();
        this.inxbuild();
        return this.colorMap();
    }
    
    setUpArrays() {
        for (let i = 0; i < this.netsize; i++) {
            this.network[i] = new Float64Array(3);
            const p = this.network[i];
            const v = (i << (8 + 8)) / this.netsize;
            p[0] = v;
            p[1] = v;
            p[2] = v;
            this.freq[i] = this.intbias / this.netsize;
            this.bias[i] = 0;
        }
    }
    
    colorMap() {
        const map = new Uint8Array(this.netsize * 3);
        const index = new Uint8Array(this.netsize);
        
        for (let i = 0; i < this.netsize; i++) index[this.network[i][3]] = i;
        
        let k = 0;
        for (let i = 0; i < this.netsize; i++) {
            const j = index[i];
            map[k++] = Math.abs(this.network[j][0]);
            map[k++] = Math.abs(this.network[j][1]);
            map[k++] = Math.abs(this.network[j][2]);
        }
        
        return map;
    }
    
    inxbuild() {
        let previouscol = 0;
        let startpos = 0;
        
        for (let i = 0; i < this.netsize; i++) {
            let smallpos = i;
            let smallval = this.network[i][1];
            
            for (let j = i + 1; j < this.netsize; j++) {
                if (this.network[j][1] < smallval) {
                    smallpos = j;
                    smallval = this.network[j][1];
                }
            }
            
            if (i != smallpos) {
                const temp = this.network[i];
                this.network[i] = this.network[smallpos];
                this.network[smallpos] = temp;
            }
            
            if (smallval != previouscol) {
                this.netindex[previouscol] = (startpos + i) >> 1;
                for (let j = previouscol + 1; j < smallval; j++) this.netindex[j] = i;
                previouscol = smallval;
                startpos = i;
            }
        }
        
        this.netindex[previouscol] = (startpos + this.maxnetpos) >> 1;
        for (let j = previouscol + 1; j < 256; j++) this.netindex[j] = this.maxnetpos;
    }
    
    learn() {
        const lengthcount = this.pixels.length;
        const samplepixels = lengthcount / (3 * this.sampleFac);
        let delta = samplepixels / 100 | 0;
        let alpha = this.initalpha;
        let radius = this.initBiasRadius;
        
        let rad = radius >> this.radiusbiasshift;
        for (let i = 0; i < rad; i++)
            this.radpower[i] = alpha * (((rad * rad - i * i) * this.radbias) / (rad * rad));
        
        let step;
        if (lengthcount < 1509) {
            this.sampleFac = 1;
            step = 3;
        } else if ((lengthcount % this.prime1) !== 0) {
            step = 3 * this.prime1;
        } else {
            if ((lengthcount % this.prime2) !== 0) {
                step = 3 * this.prime2;
            } else {
                if ((lengthcount % this.prime3) !== 0) {
                    step = 3 * this.prime3;
                } else {
                    step = 3 * this.prime4;
                }
            }
        }
        
        let i = 0;
        while (i < samplepixels) {
            const b = (this.pixels[0] << 4) & 0xff;
            const g = (this.pixels[1] << 4) & 0xff;
            const r = (this.pixels[2] << 4) & 0xff;
            const j = this.contest(b, g, r);
            
            this.altersingle(alpha, j, b, g, r);
            if (rad !== 0) this.alterneigh(rad, j, b, g, r);
            
            i++;
            if (delta === 0) delta = 1;
            if (i % delta === 0) {
                alpha -= alpha / this.alphadec;
                radius -= radius / this.radiusdec;
                rad = radius >> this.radiusbiasshift;
            }
        }
    }
    
    contest(b, g, r) {
        let bestd = ~(1 << 31);
        let bestbiasd = bestd;
        let bestpos = -1;
        let bestbiaspos = bestpos;
        
        for (let i = 0; i < this.netsize; i++) {
            const n = this.network[i];
            const dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);
            if (dist < bestd) {
                bestd = dist;
                bestpos = i;
            }
            const biasdist = dist - ((this.bias[i]) >> (this.intbiasshift - 8));
            if (biasdist < bestbiasd) {
                bestbiasd = biasdist;
                bestbiaspos = i;
            }
            const betafreq = (this.freq[i] >> 10);
            this.freq[i] -= betafreq;
            this.bias[i] += (betafreq << 10);
        }
        this.freq[bestpos] += 64;
        this.bias[bestpos] -= 65536;
        return (bestbiaspos);
    }
    
    map(b, g, r) {
        let bestd = 1000;
        let best = -1;
        const i = this.netindex[g];
        let j = i - 1;
        
        while ((i < this.netsize) || (j >= 0)) {
            if (i < this.netsize) {
                const p = this.network[i];
                const dist = p[1] - g;
                if (dist >= bestd) i = this.netsize;
                else {
                    i++;
                    if (dist < 0) dist = -dist;
                    const a = p[0] - b;
                    if (a < 0) a = -a;
                    dist += a;
                    if (dist < bestd) {
                        const e = p[2] - r;
                        if (e < 0) e = -e;
                        dist += e;
                        if (dist < bestd) {
                            bestd = dist;
                            best = p[3];
                        }
                    }
                }
            }
            if (j >= 0) {
                const p = this.network[j];
                const dist = g - p[1];
                if (dist >= bestd) j = -1;
                else {
                    j--;
                    if (dist < 0) dist = -dist;
                    const a = p[0] - b;
                    if (a < 0) a = -a;
                    dist += a;
                    if (dist < bestd) {
                        const e = p[2] - r;
                        if (e < 0) e = -e;
                        dist += e;
                        if (dist < bestd) {
                            bestd = dist;
                            best = p[3];
                        }
                    }
                }
            }
        }
        return best;
    }
    
    altersingle(alpha, i, b, g, r) {
        const n = this.network[i];
        const alphaMult = alpha / this.initalpha;
        n[0] -= alphaMult * (n[0] - b);
        n[1] -= alphaMult * (n[1] - g);
        n[2] -= alphaMult * (n[2] - r);
    }
    
    alterneigh(rad, i, b, g, r) {
        const lo = Math.abs(i - rad);
        const hi = Math.min(i + rad, this.netsize);
        let j = i + 1;
        let k = i - 1;
        let m = 1;
        
        while ((j < hi) || (k > lo)) {
            const a = this.radpower[m++];
            if (j < hi) {
                const p = this.network[j++];
                p[0] -= (a * (p[0] - b)) / this.alpharadbias;
                p[1] -= (a * (p[1] - g)) / this.alpharadbias;
                p[2] -= (a * (p[2] - r)) / this.alpharadbias;
            }
            if (k > lo) {
                const p = this.network[k--];
                p[0] -= (a * (p[0] - b)) / this.alpharadbias;
                p[1] -= (a * (p[1] - g)) / this.alpharadbias;
                p[2] -= (a * (p[2] - r)) / this.alpharadbias;
            }
        }
    }
    
    fix() {
        for (let i = 0; i < this.netsize; i++) {
            const n = this.network[i];
            n[0] = Math.max(0, Math.min(255, Math.floor(n[0] + 0.5)));
            n[1] = Math.max(0, Math.min(255, Math.floor(n[1] + 0.5)));
            n[2] = Math.max(0, Math.min(255, Math.floor(n[2] + 0.5)));
            n[3] = i;
        }
    }
    
    get intbias() { return 1 << 16; }
    get intbiasshift() { return 16; }
}