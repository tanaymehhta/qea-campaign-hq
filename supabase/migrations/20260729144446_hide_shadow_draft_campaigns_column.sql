alter table campaigns
  add column if not exists hidden boolean not null default false;

comment on column campaigns.hidden is
  'Kept out of every view and every read. For a campaign that exists in the vendor but should not count here — today, the lemlist drafts that shadow a live campaign. The sync never writes this column, so it survives a re-sync.';

update campaigns set hidden = true
where source = 'lemlist'
  and source_campaign_id in (
    'cam_mak6noLXasGrMTpfY',
    'cam_YqqHe86NEJsnbhbWz',
    'cam_3sT7qCgo3GDYB28Co',
    'cam_iHeRBCDquqcBbiLef',
    'cam_CX2grgf3mfjza7bMD',
    'cam_EartWWzJJ29DRWzgN',
    'cam_GCDsvacgYzyHHSvQ7'
  );

create index if not exists campaigns_hidden_idx on campaigns (id) where hidden;
