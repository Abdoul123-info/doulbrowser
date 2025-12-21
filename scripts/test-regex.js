const line = '[download]   8.7% of ~ 194.82MiB at    2.12MiB/s ETA 01:31 (frag 9/116)';
const regex = /\[download\]\s+(\d+\.?\d*)%\s+of\s+[~]?\s*(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)/;
const match = line.match(regex);

console.log('Line:', line);
console.log('Match:', match);

if (match) {
    console.log('Progress:', match[1]);
    console.log('Size:', match[2]);
    console.log('Speed:', match[3]);
    console.log('ETA:', match[4]);
} else {
    console.log('No match!');
}
