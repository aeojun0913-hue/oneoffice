/**
 * featuresModule.js — 공지사항 / 회의실예약 / 설문투표 / 근로계약서
 */

// ═══════════════════════════════════════════════════════
// 📢 공지사항
// ═══════════════════════════════════════════════════════
window.NoticeModule = {
  async init() {
    await this.load();
    this._bindEvents();
  },

  async load(filter) {
    filter = filter || 'all';
    const token = sessionStorage.getItem('oneoffice_jwt');
    try {
      const res  = await fetch('/api/notices', { headers: { Authorization: 'Bearer ' + token } });
      const data = await res.json();
      this.render(data.notices || [], filter);
    } catch(e) { this.render([], filter); }
  },

  render(notices, filter) {
    filter = filter || 'all';
    const list = document.getElementById('noticeList');
    if (!list) return;
    const filtered = filter === 'all' ? notices : notices.filter(function(n){ return n.category === filter; });
    if (filtered.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);"><i class="fa-solid fa-bullhorn" style="font-size:2rem;opacity:0.3;margin-bottom:10px;display:block;"></i>등록된 공지사항이 없습니다.</div>';
      return;
    }
    var categoryColors = { company: 'var(--primary)', dept: 'var(--secondary)', urgent: 'var(--danger)' };
    var categoryLabels = { company: '전사', dept: '부서', urgent: '🚨 긴급' };
    list.innerHTML = filtered.map(function(n) {
      var date  = new Date(n.createdAt).toLocaleDateString('ko-KR');
      var color = categoryColors[n.category] || 'var(--primary)';
      var label = categoryLabels[n.category] || n.category;
      return '<div class="glass" style="border-radius:12px;padding:16px 20px;border-left:4px solid ' + color + ';margin-bottom:4px;">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
        + '<div style="display:flex;align-items:center;gap:8px;">'
        + (n.pinned ? '<span style="font-size:0.75rem;background:var(--warning);color:white;padding:2px 8px;border-radius:10px;">📌 고정</span>' : '')
        + '<span style="font-size:0.75rem;background:' + color + '22;color:' + color + ';padding:2px 8px;border-radius:10px;font-weight:600;">' + label + '</span>'
        + '</div><span style="font-size:0.75rem;color:var(--text-muted);">' + date + ' · ' + n.authorName + '</span></div>'
        + '<div style="font-weight:700;font-size:0.95rem;margin-bottom:4px;">' + n.title + '</div>'
        + '<div style="font-size:0.82rem;color:var(--text-muted);line-height:1.5;white-space:pre-wrap;">' + n.content.slice(0,200) + (n.content.length > 200 ? '...' : '') + '</div>'
        + '</div>';
    }).join('');
    var user = window.AppState && AppState.currentUser;
    var writeBtn = document.getElementById('btnWriteNotice');
    if (writeBtn && user && user.role === 'admin') writeBtn.style.display = '';
  },

  _bindEvents: function() {
    var self = this;
    document.querySelectorAll('[data-notice-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('[data-notice-filter]').forEach(function(b) {
          b.style.background = 'transparent'; b.style.color = 'var(--text-muted)';
        });
        btn.style.background = 'var(--primary)'; btn.style.color = 'white';
        self.load(btn.getAttribute('data-notice-filter'));
      });
    });
    var writeBtn = document.getElementById('btnWriteNotice');
    if (writeBtn) writeBtn.addEventListener('click', function() {
      document.getElementById('noticeWriteModal') && document.getElementById('noticeWriteModal').classList.add('active');
    });
    var closeBtn = document.getElementById('noticeWriteClose');
    if (closeBtn) closeBtn.addEventListener('click', function() {
      document.getElementById('noticeWriteModal') && document.getElementById('noticeWriteModal').classList.remove('active');
    });
    var submitBtn = document.getElementById('btnSubmitNotice');
    if (submitBtn) submitBtn.addEventListener('click', async function() {
      var title    = (document.getElementById('noticeTitle') || {}).value || '';
      var content  = (document.getElementById('noticeContent') || {}).value || '';
      var category = (document.getElementById('noticeCategory') || {}).value || 'company';
      var pinned   = (document.getElementById('noticePinned') || {}).value || 'false';
      title = title.trim(); content = content.trim();
      if (!title || !content) { window.showToast('입력 오류','제목과 내용을 입력해주세요.','warning'); return; }
      var token = sessionStorage.getItem('oneoffice_jwt');
      try {
        var res = await fetch('/api/notices', {
          method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
          body: JSON.stringify({title,content,category,pinned})
        });
        var data = await res.json();
        if (data.success) {
          document.getElementById('noticeWriteModal').classList.remove('active');
          document.getElementById('noticeTitle').value = '';
          document.getElementById('noticeContent').value = '';
          await self.load();
          window.showToast('📢 공지 등록','공지사항이 등록되었습니다.','success');
        }
      } catch(e) { window.showToast('오류','공지 등록에 실패했습니다.','danger'); }
    });
  }
};

// ═══════════════════════════════════════════════════════
// 🏢 회의실 예약
// ═══════════════════════════════════════════════════════
window.RoomModule = {
  currentDate: new Date().toISOString().split('T')[0],
  rooms: [],

  async init() {
    await this._loadRooms();
    this._setDateLabel();
    await this.loadBookings();
    await this.loadMyBookings();
    this._bindEvents();
  },

  async _loadRooms() {
    var token = sessionStorage.getItem('oneoffice_jwt');
    try {
      var res = await fetch('/api/rooms', { headers:{ Authorization:'Bearer '+token } });
      var data = await res.json();
      this.rooms = data.rooms || [];
    } catch(e) { this.rooms = []; }
  },

  _setDateLabel: function() {
    var d = new Date(this.currentDate + 'T00:00:00');
    var days = ['일','월','화','수','목','금','토'];
    var el = document.getElementById('roomDateLabel');
    if (el) el.textContent = this.currentDate + ' (' + days[d.getDay()] + ')';
  },

  async loadBookings() {
    var token = sessionStorage.getItem('oneoffice_jwt');
    var grid  = document.getElementById('roomCardGrid');
    if (!grid) return;
    var self = this;
    try {
      var res  = await fetch('/api/room-bookings?date=' + this.currentDate, { headers:{ Authorization:'Bearer '+token } });
      var data = await res.json();
      var bookings = data.bookings || [];
      grid.innerHTML = this.rooms.map(function(room) {
        var rb = bookings.filter(function(b){ return b.roomId === room.id; }).sort(function(a,b){ return a.startTime.localeCompare(b.startTime); });
        var isBusy = rb.length > 0;
        return '<div class="glass" style="border-radius:14px;padding:16px;border-top:4px solid '+room.color+';">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
          + '<div style="font-weight:700;font-size:0.95rem;">'+room.name+'</div>'
          + '<span style="font-size:0.72rem;padding:3px 8px;border-radius:10px;background:'+(isBusy?'var(--danger)22':'var(--success)22')+';color:'+(isBusy?'var(--danger)':'var(--success)')+';">'+(isBusy?'사용 중':'사용 가능')+'</span>'
          + '</div>'
          + '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px;"><i class="fa-solid fa-users"></i> '+room.capacity+'인 &nbsp;|&nbsp; '+room.facilities+'</div>'
          + '<div style="display:flex;flex-direction:column;gap:4px;min-height:36px;">'
          + (rb.length === 0
              ? '<div style="font-size:0.78rem;color:var(--text-muted);">예약 없음</div>'
              : rb.map(function(b){ return '<div style="font-size:0.78rem;background:'+room.color+'22;border-radius:6px;padding:3px 8px;display:flex;justify-content:space-between;"><span>'+b.startTime+'~'+b.endTime+' '+b.purpose+'</span><span style="color:var(--text-muted);">'+b.bookedByName+'</span></div>'; }).join(''))
          + '</div></div>';
      }).join('');
    } catch(e) { grid.innerHTML = '<div style="color:var(--text-muted);">회의실 정보를 불러올 수 없습니다.</div>'; }
  },

  async loadMyBookings() {
    var token = sessionStorage.getItem('oneoffice_jwt');
    var el    = document.getElementById('myRoomBookings');
    if (!el) return;
    var self = this;
    var today = new Date().toISOString().split('T')[0];
    try {
      var res  = await fetch('/api/room-bookings', { headers:{ Authorization:'Bearer '+token } });
      var data = await res.json();
      var userId = AppState.currentUser && AppState.currentUser.id;
      var myBkgs = (data.bookings || []).filter(function(b){ return b.bookedBy === userId && b.date >= today; })
        .sort(function(a,b){ return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime); }).slice(0,5);
      if (myBkgs.length === 0) {
        el.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);">예약한 회의실이 없습니다.</div>';
        return;
      }
      el.innerHTML = myBkgs.map(function(b) {
        var room = self.rooms.find(function(r){ return r.id === b.roomId; });
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-card);border-radius:8px;font-size:0.82rem;margin-bottom:4px;">'
          + '<div><div style="font-weight:600;">'+(room ? room.name : b.roomId)+'</div>'
          + '<div style="color:var(--text-muted);">'+b.date+' '+b.startTime+'~'+b.endTime+' · '+b.purpose+'</div></div>'
          + '<button onclick="RoomModule.cancelBooking(\''+b.id+'\')" style="background:var(--danger);color:white;border:none;border-radius:6px;padding:4px 10px;font-size:0.75rem;cursor:pointer;">취소</button>'
          + '</div>';
      }).join('');
    } catch(e) {}
  },

  async cancelBooking(id) {
    var token = sessionStorage.getItem('oneoffice_jwt');
    try {
      var res  = await fetch('/api/room-bookings/'+id, { method:'DELETE', headers:{ Authorization:'Bearer '+token } });
      var data = await res.json();
      if (data.success) {
        await this.loadBookings();
        await this.loadMyBookings();
        window.showToast('✅ 예약 취소','회의실 예약이 취소되었습니다.','info');
      } else { window.showToast('오류', data.error, 'danger'); }
    } catch(e) { window.showToast('오류','취소 처리에 실패했습니다.','danger'); }
  },

  _bindEvents: function() {
    var self = this;
    document.getElementById('btnRoomDatePrev') && document.getElementById('btnRoomDatePrev').addEventListener('click', function() {
      var d = new Date(self.currentDate + 'T00:00:00'); d.setDate(d.getDate()-1);
      self.currentDate = d.toISOString().split('T')[0]; self._setDateLabel(); self.loadBookings();
    });
    document.getElementById('btnRoomDateNext') && document.getElementById('btnRoomDateNext').addEventListener('click', function() {
      var d = new Date(self.currentDate + 'T00:00:00'); d.setDate(d.getDate()+1);
      self.currentDate = d.toISOString().split('T')[0]; self._setDateLabel(); self.loadBookings();
    });
    document.getElementById('btnRoomDateToday') && document.getElementById('btnRoomDateToday').addEventListener('click', function() {
      self.currentDate = new Date().toISOString().split('T')[0]; self._setDateLabel(); self.loadBookings();
    });
    var bookModal = document.getElementById('roomBookModal');
    document.getElementById('btnBookRoom') && document.getElementById('btnBookRoom').addEventListener('click', function() {
      var di = document.getElementById('roomBookDate'); if (di) di.value = self.currentDate;
      bookModal && bookModal.classList.add('active');
    });
    document.getElementById('roomBookClose') && document.getElementById('roomBookClose').addEventListener('click', function() {
      bookModal && bookModal.classList.remove('active');
    });
    document.getElementById('btnConfirmRoomBook') && document.getElementById('btnConfirmRoomBook').addEventListener('click', async function() {
      var roomId    = (document.getElementById('roomSelect')||{}).value;
      var date      = (document.getElementById('roomBookDate')||{}).value;
      var startTime = (document.getElementById('roomBookStart')||{}).value;
      var endTime   = (document.getElementById('roomBookEnd')||{}).value;
      var purpose   = ((document.getElementById('roomBookPurpose')||{}).value||'').trim();
      if (!date||!startTime||!endTime) { window.showToast('입력 오류','날짜와 시간을 선택해주세요.','warning'); return; }
      if (startTime >= endTime) { window.showToast('시간 오류','종료 시간은 시작 시간보다 늦어야 합니다.','warning'); return; }
      var token = sessionStorage.getItem('oneoffice_jwt');
      try {
        var res  = await fetch('/api/room-bookings', {
          method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
          body: JSON.stringify({roomId,date,startTime,endTime,purpose})
        });
        var data = await res.json();
        if (data.success) {
          bookModal && bookModal.classList.remove('active');
          self.currentDate = date; self._setDateLabel();
          await self.loadBookings(); await self.loadMyBookings();
          window.showToast('🏢 예약 완료',date+' '+startTime+'~'+endTime+' 예약이 완료되었습니다.','success');
        } else { window.showToast('예약 실패', data.error, 'danger'); }
      } catch(e) { window.showToast('오류','예약 처리에 실패했습니다.','danger'); }
    });
  }
};

// ═══════════════════════════════════════════════════════
// 📊 설문 / 투표
// ═══════════════════════════════════════════════════════
window.SurveyModule = {
  surveys: [],
  async init() { await this.load(); this._bindEvents(); },

  async load() {
    var token = sessionStorage.getItem('oneoffice_jwt');
    try {
      var res  = await fetch('/api/surveys', { headers:{ Authorization:'Bearer '+token } });
      var data = await res.json();
      this.surveys = data.surveys || [];
    } catch(e) { this.surveys = []; }
    this.render();
  },

  render: function() {
    var list = document.getElementById('surveyList');
    if (!list) return;
    var self  = this;
    var userId = AppState.currentUser && AppState.currentUser.id;
    if (this.surveys.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);"><i class="fa-solid fa-poll" style="font-size:2rem;opacity:0.3;display:block;margin-bottom:10px;"></i>진행 중인 설문이 없습니다.</div>';
      return;
    }
    list.innerHTML = this.surveys.map(function(s) {
      var total     = s.options.reduce(function(sum,o){ return sum+o.count; }, 0);
      var hasVoted  = s.options.some(function(o){ return o.votes.indexOf(userId) !== -1; });
      var deadline  = s.deadline ? ('마감 ' + s.deadline) : '마감 없음';
      return '<div class="glass" style="border-radius:14px;padding:18px;border-left:4px solid var(--accent);margin-bottom:4px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px;">'
        + '<div><div style="font-weight:700;font-size:0.95rem;">'+s.title+'</div>'
        + '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;">'+s.authorName+' · '+deadline+' · '+(s.anonymous?'익명':'실명')+' · 총 '+total+'명 참여</div></div>'
        + (!hasVoted && !s.closed ? '<button onclick="SurveyModule.openVote(\''+s.id+'\')" class="btn-primary" style="padding:6px 14px;font-size:0.82rem;white-space:nowrap;">투표하기</button>' : '<span style="font-size:0.8rem;color:var(--success);">✅ 투표 완료</span>')
        + '</div>'
        + '<div style="display:flex;flex-direction:column;gap:6px;">'
        + s.options.map(function(o) {
            var pct = total > 0 ? Math.round(o.count/total*100) : 0;
            return '<div><div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:3px;"><span>'+o.text+'</span><span style="color:var(--text-muted);">'+o.count+'명 ('+pct+'%)</span></div>'
              + '<div style="height:8px;background:var(--bg-card);border-radius:4px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:var(--accent);border-radius:4px;transition:width 0.4s;"></div></div></div>';
          }).join('')
        + '</div></div>';
    }).join('');
  },

  openVote: function(surveyId) {
    var survey = this.surveys.find(function(s){ return s.id === surveyId; });
    if (!survey) return;
    var modal = document.getElementById('surveyVoteModal');
    var title = document.getElementById('surveyVoteTitle');
    var opts  = document.getElementById('surveyVoteOptions');
    if (!modal||!title||!opts) return;
    title.textContent = survey.title;
    opts.innerHTML = survey.options.map(function(o,i) {
      return '<label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--border-color);border-radius:8px;cursor:pointer;font-size:0.88rem;">'
        + '<input type="radio" name="surveyOpt" value="'+i+'" style="accent-color:var(--accent);">'+o.text+'</label>';
    }).join('');
    modal.dataset.surveyId = surveyId;
    modal.classList.add('active');
  },

  _bindEvents: function() {
    var self = this;
    document.getElementById('surveyVoteClose') && document.getElementById('surveyVoteClose').addEventListener('click', function() {
      document.getElementById('surveyVoteModal') && document.getElementById('surveyVoteModal').classList.remove('active');
    });
    document.getElementById('btnSubmitVote') && document.getElementById('btnSubmitVote').addEventListener('click', async function() {
      var modal   = document.getElementById('surveyVoteModal');
      var chosen  = document.querySelector('input[name="surveyOpt"]:checked');
      if (!chosen) { window.showToast('선택 오류','항목을 선택해주세요.','warning'); return; }
      var surveyId = modal && modal.dataset.surveyId;
      var token    = sessionStorage.getItem('oneoffice_jwt');
      try {
        var res  = await fetch('/api/surveys/'+surveyId+'/vote', {
          method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
          body: JSON.stringify({optionIndex: Number(chosen.value)})
        });
        var data = await res.json();
        if (data.success) {
          modal && modal.classList.remove('active');
          await self.load();
          window.showToast('✅ 투표 완료','투표가 완료되었습니다.','success');
        } else { window.showToast('오류', data.error, 'danger'); }
      } catch(e) { window.showToast('오류','투표에 실패했습니다.','danger'); }
    });
    document.getElementById('btnCreateSurvey') && document.getElementById('btnCreateSurvey').addEventListener('click', function() {
      document.getElementById('surveyCreateModal') && document.getElementById('surveyCreateModal').classList.add('active');
    });
    document.getElementById('surveyCreateClose') && document.getElementById('surveyCreateClose').addEventListener('click', function() {
      document.getElementById('surveyCreateModal') && document.getElementById('surveyCreateModal').classList.remove('active');
    });
    document.getElementById('btnAddSurveyOption') && document.getElementById('btnAddSurveyOption').addEventListener('click', function() {
      var optList = document.getElementById('surveyOptionsList');
      var count   = optList ? optList.querySelectorAll('.survey-option').length : 0;
      var div = document.createElement('div');
      div.style.cssText = 'display:flex;gap:6px;margin-top:4px;';
      div.innerHTML = '<input type="text" class="form-control survey-option" placeholder="항목 '+(count+1)+'"><button type="button" class="survey-remove-btn" style="background:var(--danger);color:white;border:none;border-radius:6px;padding:0 10px;cursor:pointer;">✕</button>';
      optList && optList.appendChild(div);
      div.querySelector('.survey-remove-btn') && div.querySelector('.survey-remove-btn').addEventListener('click', function(){ div.remove(); });
    });
    document.querySelectorAll('.survey-remove-btn').forEach(function(btn){ btn.addEventListener('click', function(){ btn.parentElement && btn.parentElement.remove(); }); });
    document.getElementById('btnSubmitSurvey') && document.getElementById('btnSubmitSurvey').addEventListener('click', async function() {
      var title     = ((document.getElementById('surveyTitle')||{}).value||'').trim();
      var deadline  = (document.getElementById('surveyDeadline')||{}).value || '';
      var anonymous = (document.getElementById('surveyAnonymous')||{}).value;
      var options   = Array.from(document.querySelectorAll('.survey-option')).map(function(i){ return i.value.trim(); }).filter(Boolean);
      if (!title) { window.showToast('입력 오류','설문 제목을 입력해주세요.','warning'); return; }
      if (options.length < 2) { window.showToast('입력 오류','선택 항목을 2개 이상 입력해주세요.','warning'); return; }
      var token = sessionStorage.getItem('oneoffice_jwt');
      try {
        var res = await fetch('/api/surveys', {
          method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
          body: JSON.stringify({title, deadline, anonymous: anonymous === 'true', options})
        });
        var data = await res.json();
        if (data.success) {
          document.getElementById('surveyCreateModal') && document.getElementById('surveyCreateModal').classList.remove('active');
          document.getElementById('surveyTitle') && (document.getElementById('surveyTitle').value='');
          await self.load();
          window.showToast('📊 설문 등록','설문이 등록되었습니다.','success');
        }
      } catch(e) { window.showToast('오류','설문 등록에 실패했습니다.','danger'); }
    });
  }
};

// ═══════════════════════════════════════════════════════
// 📝 근로계약서
// ═══════════════════════════════════════════════════════
window.ContractModule = {
  contracts: [],
  async init() { await this.load(); this._bindEvents(); },

  async load() {
    var token = sessionStorage.getItem('oneoffice_jwt');
    try {
      var res  = await fetch('/api/contracts', { headers:{ Authorization:'Bearer '+token } });
      var data = await res.json();
      this.contracts = data.contracts || [];
    } catch(e) { this.contracts = []; }
    this.render();
  },

  render: function() {
    var list  = document.getElementById('contractList');
    if (!list) return;
    var today = new Date().toISOString().split('T')[0];
    var in30  = new Date(Date.now() + 30*86400000).toISOString().split('T')[0];
    var active=0, expiring=0, expired=0;
    this.contracts.forEach(function(c) {
      if (!c.endDate || c.endDate > today) {
        active++;
        if (c.endDate && c.endDate <= in30) expiring++;
      } else { expired++; }
    });
    var s = function(id){ return document.getElementById(id); };
    if (s('contractStatActive'))   s('contractStatActive').textContent   = active;
    if (s('contractStatExpiring')) s('contractStatExpiring').textContent = expiring;
    if (s('contractStatExpired'))  s('contractStatExpired').textContent  = expired;
    if (this.contracts.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);"><i class="fa-solid fa-file-signature" style="font-size:2rem;opacity:0.3;display:block;margin-bottom:10px;"></i>등록된 근로계약서가 없습니다.</div>';
      return;
    }
    list.innerHTML = this.contracts.map(function(c) {
      var isExpired  = c.endDate && c.endDate < today;
      var isExpiring = !isExpired && c.endDate && c.endDate <= in30;
      var statusColor = c.status === 'signed' ? 'var(--success)' : isExpired ? 'var(--danger)' : isExpiring ? 'var(--warning)' : 'var(--text-muted)';
      var statusLabel = c.status === 'signed' ? '✅ 서명 완료' : isExpired ? '❌ 만료' : isExpiring ? '⚠️ 만료 임박' : '⏳ 서명 대기';
      return '<div class="glass" style="border-radius:12px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;margin-bottom:6px;" onclick="ContractModule.openDetail(\''+c.id+'\')">'
        + '<div style="display:flex;align-items:center;gap:14px;">'
        + '<div style="width:42px;height:42px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;">'+(c.employeeName||'?')[0]+'</div>'
        + '<div><div style="font-weight:700;font-size:0.92rem;">'+c.employeeName+' <span style="font-weight:400;color:var(--text-muted);font-size:0.82rem;">'+c.position+'</span></div>'
        + '<div style="font-size:0.78rem;color:var(--text-muted);">'+c.startDate+' ~ '+(c.endDate||'무기한')+' · '+c.workHours+'</div></div></div>'
        + '<span style="font-size:0.82rem;font-weight:600;color:'+statusColor+';">'+statusLabel+'</span>'
        + '</div>';
    }).join('');
    var user = AppState.currentUser;
    var createBtn = document.getElementById('btnCreateContract');
    if (createBtn && user && user.role === 'admin') createBtn.style.display = '';
  },

  openDetail: function(id) {
    var c = this.contracts.find(function(ct){ return ct.id === id; });
    if (!c) return;
    var modal    = document.getElementById('contractDetailModal');
    var body     = document.getElementById('contractDetailBody');
    var signArea = document.getElementById('contractSignArea');
    if (!modal||!body) return;
    body.innerHTML = '<div style="text-align:center;margin-bottom:16px;padding:10px 0;border-bottom:2px solid var(--border-color);">'
      + '<div style="font-size:1.1rem;font-weight:800;">근 로 계 약 서</div>'
      + '<div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">표준 근로계약서 (근로기준법 제17조)</div></div>'
      + '<table style="width:100%;font-size:0.82rem;border-collapse:collapse;">'
      + '<tr><td style="padding:6px 10px;background:var(--bg-card);font-weight:600;border:1px solid var(--border-color);width:120px;">성명</td><td style="padding:6px 10px;border:1px solid var(--border-color);">'+c.employeeName+'</td></tr>'
      + '<tr><td style="padding:6px 10px;background:var(--bg-card);font-weight:600;border:1px solid var(--border-color);">직위/직책</td><td style="padding:6px 10px;border:1px solid var(--border-color);">'+(c.position||'-')+'</td></tr>'
      + '<tr><td style="padding:6px 10px;background:var(--bg-card);font-weight:600;border:1px solid var(--border-color);">근로 기간</td><td style="padding:6px 10px;border:1px solid var(--border-color);">'+c.startDate+' ~ '+(c.endDate||'무기한')+'</td></tr>'
      + '<tr><td style="padding:6px 10px;background:var(--bg-card);font-weight:600;border:1px solid var(--border-color);">소정 근로시간</td><td style="padding:6px 10px;border:1px solid var(--border-color);">'+c.workHours+'</td></tr>'
      + '<tr><td style="padding:6px 10px;background:var(--bg-card);font-weight:600;border:1px solid var(--border-color);">임금</td><td style="padding:6px 10px;border:1px solid var(--border-color);">'+(c.salary||'-')+'</td></tr>'
      + '</table>'
      + '<div style="margin-top:14px;font-size:0.78rem;color:var(--text-muted);line-height:1.7;">위 근로조건을 성실히 이행할 것을 확약하며, 근로기준법 등 관계 법령을 준수할 것을 동의합니다.<br>계약 일자: '+new Date(c.createdAt).toLocaleDateString('ko-KR')+'</div>'
      + (c.signedAt ? '<div style="margin-top:10px;padding:8px 14px;background:var(--success)22;border-radius:8px;font-size:0.82rem;color:var(--success);">✅ 서명 완료: '+c.signedBy+' ('+new Date(c.signedAt).toLocaleDateString('ko-KR')+')</div>' : '');
    var user = AppState.currentUser;
    if (signArea) {
      signArea.style.display = (!c.signedAt && user && c.employeeId === user.id) ? '' : 'none';
      signArea.dataset.contractId = id;
    }
    modal.classList.add('active');
  },

  _bindEvents: function() {
    var self = this;
    document.getElementById('contractDetailClose') && document.getElementById('contractDetailClose').addEventListener('click', function() {
      document.getElementById('contractDetailModal') && document.getElementById('contractDetailModal').classList.remove('active');
    });
    document.getElementById('btnSignContract') && document.getElementById('btnSignContract').addEventListener('click', async function() {
      var signature = ((document.getElementById('contractSignInput')||{}).value||'').trim();
      if (!signature) { window.showToast('서명 필요','성명을 입력하여 서명해주세요.','warning'); return; }
      var signArea = document.getElementById('contractSignArea');
      var id    = signArea && signArea.dataset.contractId;
      var token = sessionStorage.getItem('oneoffice_jwt');
      try {
        var res  = await fetch('/api/contracts/'+id+'/sign', {
          method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
          body: JSON.stringify({signature})
        });
        var data = await res.json();
        if (data.success) {
          document.getElementById('contractDetailModal') && document.getElementById('contractDetailModal').classList.remove('active');
          await self.load();
          window.showToast('✅ 서명 완료','근로계약서 서명이 완료되었습니다.','success');
        } else { window.showToast('오류', data.error, 'danger'); }
      } catch(e) { window.showToast('오류','서명 처리에 실패했습니다.','danger'); }
    });
  }
};

