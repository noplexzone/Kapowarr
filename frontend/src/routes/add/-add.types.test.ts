import { describe, expect, it } from 'vitest';
import { searchResultSchema } from './-add.types';

describe('searchResultSchema', () => {
  it('accepts ComicVine results with nullable optional metadata fields', () => {
    const result = searchResultSchema.parse({
      comicvine_id: 4050,
      metadata_source: 'comicvine',
      metadata_id: '4050',
      title: 'What If...? Secret Wars',
      year: 2015,
      publisher: null,
      volume_number: 1,
      cover_url: null,
      cover_link: null,
      description: null,
      aliases: null,
      issue_count: null,
      already_added: null,
    });

    expect(result.description).toBeNull();
    expect(result.title).toBe('What If...? Secret Wars');
  });
});
