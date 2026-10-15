import { describe, it, expect } from 'vitest';
import { byName, folderIdFrom, jpegNameFor, jpegSize, parseFolderListing, parseFolderTitle, pickPhotos, type DriveEntry } from './drive';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('folderIdFrom', () => {
  it('reads a share link', () => expect(folderIdFrom(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)).toBe(ID));
  it('reads a u/0 link', () => expect(folderIdFrom(`https://drive.google.com/drive/u/0/folders/${ID}`)).toBe(ID));
  it('reads an ?id= link', () => expect(folderIdFrom(`https://drive.google.com/open?id=${ID}`)).toBe(ID));
  it('takes a bare id', () => expect(folderIdFrom(`  ${ID} `)).toBe(ID));
  it('refuses junk', () => {
    expect(folderIdFrom('https://example.com/photos')).toBeNull();
    expect(folderIdFrom('')).toBeNull();
  });
});

/** The shape of Drive's embedded folder view, trimmed to what the parser reads. */
function entry(id: string, name: string, folder = false): string {
  const href = folder ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view?usp=drive_web`;
  return `<div class="flip-entry" id="entry-${id}" tabindex="0" role="link"><div class="flip-entry-info"><a href="${href}" target="_blank"><div class="flip-entry-visual"><div class="flip-entry-thumb"><img src="https://lh3.googleusercontent.com/x=s190" alt="JPEG Image"/></div></div><div class="flip-entry-title">${name}</div></a></div></div>`;
}

describe('parseFolderListing', () => {
  const html = `<html><head><title>Club Photos</title></head><body>${entry('folder_one_id', 'Week 1', true)}${entry('file_one_id_x', 'DSC0001.JPG')}${entry('file_two_id_x', 'Tom &amp; Jerry&#39;s.jpg')}</body></html>`;
  it('reads folders and files', () => {
    expect(parseFolderListing(html)).toEqual([
      { id: 'folder_one_id', name: 'Week 1', folder: true },
      { id: 'file_one_id_x', name: 'DSC0001.JPG', folder: false },
      { id: 'file_two_id_x', name: "Tom & Jerry's.jpg", folder: false },
    ]);
  });
  it('reads the title', () => expect(parseFolderTitle(html)).toBe('Club Photos'));
  it('an empty folder is an empty list', () => expect(parseFolderListing('<html></html>')).toEqual([]));
});

describe('pickPhotos', () => {
  const f = (id: string, name: string): DriveEntry => ({ id, name, folder: false });

  it('drops Mac ._ files and folders', () => {
    expect(pickPhotos([f('a', '._DSC1.JPG'), f('b', 'DSC1.JPG'), { id: 'c', name: 'Sub', folder: true }]).map((p) => p.fileId)).toEqual(['b']);
  });

  it('drops " 2" copies of a file that is already there, keeps a lone one', () => {
    const got = pickPhotos([f('a', 'DSC1.JPG'), f('b', 'DSC1 2.JPG'), f('c', 'DSC2 2.JPG')]);
    expect(got.map((p) => p.fileId)).toEqual(['a', 'c']);
  });

  it('pairs a RAW with its JPEG, and shows a lone RAW itself', () => {
    const got = pickPhotos([f('j1', 'DSC1.JPG'), f('r1', 'DSC1.ARW'), f('r2', 'DSC2.ARW'), f('r2c', 'DSC2 2.ARW')]);
    expect(got).toEqual([
      { fileId: 'j1', name: 'DSC1.JPG', kind: 'jpeg', rawFileId: 'r1' },
      { fileId: 'r2', name: 'DSC2.ARW', kind: 'raw', rawFileId: 'r2' },
    ]);
  });

  it('a lone copy still pairs with its RAW', () => {
    expect(pickPhotos([f('c', 'DSC1 2.JPG'), f('r', 'DSC1.ARW')])).toEqual([{ fileId: 'c', name: 'DSC1 2.JPG', kind: 'jpeg', rawFileId: 'r' }]);
  });

  it('ignores anything that is not a photo', () => {
    expect(pickPhotos([f('a', 'notes.txt'), f('b', 'clip.MP4'), f('c', 'a.png')]).map((p) => p.fileId)).toEqual(['c']);
  });

  it('sorts in camera order', () => {
    expect(pickPhotos([f('a', 'DSC10.JPG'), f('b', 'DSC9.JPG'), f('c', 'dsc11.jpg')]).map((p) => p.name)).toEqual(['DSC9.JPG', 'DSC10.JPG', 'dsc11.jpg']);
  });
});

describe('byName', () => {
  it('is natural', () => expect(['b10', 'b2', 'a'].sort(byName)).toEqual(['a', 'b2', 'b10']));
});

describe('jpegSize', () => {
  it('reads the frame header past other segments', () => {
    // SOI, an APP0 of 4 bytes, then SOF0 with height 1667 and width 2500.
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x06, 0x83, 0x09, 0xc4, 0x03, 0, 0, 0]);
    expect(jpegSize(b)).toEqual({ width: 2500, height: 1667 });
  });
  it('is null for a non-JPEG', () => expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull());
});

describe('jpegNameFor', () => {
  it('swaps the extension', () => expect(jpegNameFor('DSC04783.ARW')).toBe('DSC04783.jpg'));
  it('cleans odd characters', () => expect(jpegNameFor('Team photo (1).heic')).toBe('Team_photo_1_.jpg'));
});
