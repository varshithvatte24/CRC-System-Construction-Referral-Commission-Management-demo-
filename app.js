/* app.js
   UI logic for dashboard.html
   - Renders views based on hash navigation
   - Hooks into CRCData for data ops
   - Listens to BroadcastChannel for realtime updates
   
   REFACTORED for:
   - DOM element creation (no innerHTML)
   - Modal forms (no prompts)
   - Cleaner lists and inline editing
   - Non-destructive search filtering
*/

(function() {
  const toastEl = document.getElementById('toast'),
    feedEl = document.getElementById('feed');
  let toastTimer = null;

  function toast(msg, ms = 2400) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
  }

  const BC = new BroadcastChannel('crc_channel_v3');
  BC.onmessage = (ev) => {
    const d = ev.data || {};
    if (!d) return;
    if (d.type === 'sync' || d.type === 'auth' || d.type === 'cleared') {
      renderFeedItem(d);
      render(); // Re-render current view on sync
    }
  };

  // DOM refs
  const refs = {
    pageTitle: document.getElementById('page-title'),
    pageDesc: document.getElementById('page-desc'),
    viewArea: document.getElementById('view-area'),
    navLinks: document.querySelectorAll('.nav-link'),
    avatar: document.getElementById('avatar'),
    displayName: document.getElementById('display-name'),
    displayRole: document.getElementById('display-role'),
    bcStatus: document.getElementById('bc-status'),
    feed: feedEl,
    sUsers: document.getElementById('s-users'),
    sProjects: document.getElementById('s-projects'),
    globalSearch: document.getElementById('global-search'),
    btnNew: document.getElementById('btn-new'),
    btnSwitch: document.getElementById('btn-switch'),
    btnLogout: document.getElementById('btn-logout'),
    quickAddLead: document.getElementById('quick-add-lead'),
    quickAddProject: document.getElementById('quick-add-project')
  };

  // ----------------------------------------
  // NEW: UI & DOM Helpers
  // ----------------------------------------

  /**
   * Creates a DOM element.
   * @param {string} tag - The HTML tag.
   * @param {object} attrs - Attributes (e.g., className, style, onclick, textContent).
   * @param {...(Node|string|null|boolean|Array)} children - Child elements.
   * @returns {HTMLElement}
   */
  function el(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value);
      } else if (key === 'className') {
        element.className = value;
      } else if (key === 'textContent') {
        element.textContent = value;
      } else if (key === 'onclick' && typeof value === 'function') {
        element.addEventListener('click', value);
      } else if (key.startsWith('data-')) {
        element.dataset[key.substring(5)] = value;
      } else {
        element.setAttribute(key, value);
      }
    }
    // Append children, filtering out null/false for conditional rendering
    element.append(...children.flat().filter(c => c !== null && c !== false));
    return element;
  }

  /**
   * Injects modal styles into the head.
   */
  function injectModalStyles() {
    if (document.getElementById('crc-modal-styles')) return;
    document.head.append(el('style', {
      id: 'crc-modal-styles',
      textContent: `
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: grid; place-items: center; z-index: 1000; }
        .modal-panel { width: 480px; max-width: 90%; background: var(--panel); border: 1px solid rgba(255,255,255,0.1); box-shadow: var(--shadow); border-radius: var(--radius); padding: 18px; }
        .modal-content { margin-top: 12px; }
      `
    }));
  }

  /**
   * Displays a modal dialog.
   * @param {string} title - The modal title.
   * @param {HTMLElement} contentEl - The element to show as modal content (e.g., a form).
   * @param {function} onSave - Callback function. If it returns true, modal closes.
   */
  function showModal(title, contentEl, onSave) {
    injectModalStyles();

    let modalOverlay; // Declare for removal
    const removeModal = () => modalOverlay.remove();

    modalOverlay = el('div', {
      className: 'modal-overlay',
      onclick: (e) => {
        if (e.target === modalOverlay) removeModal();
      }
    },
      el('div', {
        className: 'modal-panel'
      },
        el('h3', {
          textContent: title
        }),
        el('div', {
          className: 'modal-content'
        }, contentEl),
        el('div', {
          className: 'form-actions'
        },
          el('button', {
            className: 'btn',
            textContent: 'Cancel',
            onclick: removeModal
          }),
          el('button', {
            className: 'btn primary',
            textContent: 'Save',
            onclick: () => {
              if (onSave()) removeModal();
            }
          })
        )
      )
    );
    document.body.append(modalOverlay);
  }

  /**
   * Creates a "click-to-edit" field for the project detail view.
   * @param {string} label - The field label.
   * @param {*} value - The current value.
   * @param {function} onSave - Callback when saving (passes new value).
   * @param {string} inputType - The type of input (e.g., 'text', 'number').
   * @param {function} displayFormatter - Function to format the display value.
   */
  function createEditableField(label, value, onSave, inputType = 'text', displayFormatter = (v) => v) {
    const valEl = el('span', {
      textContent: displayFormatter(value),
      style: {
        cursor: 'pointer',
        borderBottom: '1px dashed var(--muted)'
      }
    });
    const wrapper = el('p', {}, el('strong', {}, `${label}: `), valEl);

    valEl.onclick = () => {
      const input = el('input', {
        type: inputType,
        value: value,
        style: {
          width: '140px'
        }
      });
      wrapper.replaceChild(input, valEl);
      input.focus();

      const save = () => {
        const newValue = (inputType === 'number') ? Number(input.value) : input.value;
        onSave(newValue);
        // Let the onSave handler re-render the view
      };

      input.onblur = () => wrapper.replaceChild(valEl, input); // Cancel on blur
      input.onkeydown = (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') wrapper.replaceChild(valEl, input);
      };
    };
    return wrapper;
  }

  // ----------------------------------------
  // Utilities
  // ----------------------------------------
  function formatCurrency(n) {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(Number(n) || 0);
  }

  function getSession() {
    return CRCData.getSession();
  }

  function requireAuth() {
    const s = getSession();
    if (!s) {
      location.href = 'index.html';
      return null;
    }
    return s;
  }

  // ----------------------------------------
  // Navigation & Top-Level Events
  // ----------------------------------------
  function setActiveNav(view) {
    refs.navLinks.forEach(a => a.classList.toggle('active', a.dataset.view === view));
  }
  window.addEventListener('hashchange', render);
  document.querySelectorAll('.nav-link').forEach(a => a.addEventListener('click', (e) => {
    location.hash = a.dataset.view;
  }));

  refs.btnLogout.addEventListener('click', () => {
    CRCData.clearSession();
    location.href = 'index.html';
  });

  refs.btnSwitch.addEventListener('click', () => {
    const users = CRCData.read(CRCData.KEYS.users, []);
    if (!users.length) return toast('No users to switch. Create one.');
    const next = users[Math.floor(Math.random() * users.length)];
    CRCData.setSession(next);
    toast('Switched to ' + next.name);
    render();
  });

  // NEW: "New" button with modal
  refs.btnNew.addEventListener('click', () => {
    const session = getSession();
    if (!session) return location.href = 'index.html';

    let title, formContent, saveHandler;

    if (session.role === 'customer') {
      title = 'Create New Project';
      const locInput = el('input', {
        id: 'modal-loc',
        placeholder: 'e.g., Greenhill Estate'
      });
      const budInput = el('input', {
        id: 'modal-bud',
        type: 'number',
        placeholder: '10000'
      });
      formContent = el('div', {
        className: 'forms'
      },
        el('label', {}, 'Project Location', locInput),
        el('label', {}, 'Budget (USD)', budInput)
      );
      saveHandler = () => {
        const loc = locInput.value.trim();
        const bud = Number(budInput.value) || 0;
        if (!loc) {
          toast('Location is required');
          return false;
        }
        CRCData.addProject(session.id, {
          location: loc,
          budget: bud,
          timeline: 12
        });
        toast('Project created');
        render();
        return true; // close modal
      };

    } else if (session.role === 'referrer') {
      title = 'Add New Lead';
      const emailInput = el('input', {
        id: 'modal-email',
        type: 'email',
        placeholder: 'customer@example.com'
      });
      const notesInput = el('input', {
        id: 'modal-notes',
        placeholder: 'e.g., Interested in 3BHK'
      });
      formContent = el('div', {
        className: 'forms'
      },
        el('label', {}, 'Lead Email', emailInput),
        el('label', {}, 'Notes (optional)', notesInput)
      );
      saveHandler = () => {
        const email = emailInput.value.trim();
        if (!email) {
          toast('Email is required');
          return false;
        }
        CRCData.addLead(session.id, email, notesInput.value.trim());
        toast('Lead added');
        render();
        return true;
      };

    } else {
      // Admin
      title = 'Create Project for Customer';
      const emailInput = el('input', {
        id: 'modal-cust-email',
        type: 'email',
        placeholder: 'customer@example.com'
      });
      const locInput = el('input', {
        id: 'modal-loc',
        placeholder: 'e.g., Downtown Loft'
      });
      const budInput = el('input', {
        id: 'modal-bud',
        type: 'number',
        placeholder: '20000'
      });
      formContent = el('div', {
        className: 'forms'
      },
        el('label', {}, 'Customer Email', emailInput),
        el('label', {}, 'Project Location', locInput),
        el('label', {}, 'Budget (USD)', budInput)
      );
      saveHandler = () => {
        const custEmail = emailInput.value.trim();
        const loc = locInput.value.trim();
        if (!custEmail || !loc) {
          toast('Email and location required');
          return false;
        }
        const cust = CRCData.registerOrGetUserByEmail(custEmail, custEmail.split('@')[0], 'customer');
        const bud = Number(budInput.value) || 0;
        CRCData.addProject(cust.id, {
          location: loc,
          budget: bud
        });
        toast('Project created for ' + cust.email);
        render();
        return true;
      };
    }
    showModal(title, formContent, saveHandler);
  });

  // NEW: Search handler (just calls render)
  refs.globalSearch.addEventListener('input', render);

  // Quick actions
  refs.quickAddLead.addEventListener('click', () => {
    const s = requireAuth();
    if (!s) return;
    if (s.role !== 'referrer') return toast('Switch to a referrer to add leads');
    // Re-use the main "New" button logic
    refs.btnNew.click();
  });
  refs.quickAddProject.addEventListener('click', () => {
    const s = requireAuth();
    if (!s) return;
    if (s.role !== 'customer') return toast('Switch to a customer to add projects');
    // Re-use the main "New" button logic
    refs.btnNew.click();
  });

  // ----------------------------------------
  // Feed Rendering
  // ----------------------------------------
  function renderFeedItem(d) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<div><div class="muted small">${new Date().toLocaleTimeString()}</div><div>${d.type} ${d.key ? '- ' + d.key : ''}</div></div>`;
    refs.feed.prepend(el);
    if (refs.feed.children.length > 12) refs.feed.removeChild(refs.feed.children[12]);
    refs.bcStatus.textContent = 'online';
  }

  // ----------------------------------------
  // Views
  // ----------------------------------------

  function viewOverview() {
    const s = requireAuth();
    if (!s) return;
    refs.pageTitle.textContent = 'Overview';
    refs.pageDesc.textContent = `Hello ${s.name} — role: ${s.role}`;
    const users = CRCData.read(CRCData.KEYS.users, []);
    const projects = CRCData.read(CRCData.KEYS.projects, []);
    const leads = CRCData.read(CRCData.KEYS.leads, []);
    refs.sUsers.textContent = users.length;
    refs.sProjects.textContent = projects.length;

    const openProjects = projects.filter(p => p.status !== 'completed').length;
    const pendingLeads = leads.filter(l => l.status === 'new').length;

    // Mini feed
    const miniFeed = el('div', {
      id: 'mini-feed',
      className: 'list'
    });
    Array.from(refs.feed.children).slice(0, 6).forEach(ch => miniFeed.appendChild(ch.cloneNode(true)));

    refs.viewArea.innerHTML = ''; // Clear
    refs.viewArea.append(
      el('div', {
        className: 'grid-2'
      },
        el('div', {
          className: 'panel'
        },
          el('h3', {}, 'Quick stats'),
          el('div', {
            style: {
              display: 'flex',
              gap: '12px',
              marginTop: '10px'
            }
          },
            el('div', {
              style: {
                flex: '1'
              }
            },
              el('small', {
                className: 'muted'
              }, 'Open Projects'),
              el('div', {
                style: {
                  fontWeight: '800'
                }
              }, openProjects)
            ),
            el('div', {
              style: {
                flex: '1'
              }
            },
              el('small', {
                className: 'muted'
              }, 'Pending leads'),
              el('div', {
                style: {
                  fontWeight: '800'
                }
              }, pendingLeads)
            )
          )
        ),
        el('div', {
          className: 'panel'
        },
          el('h3', {}, 'Recent activity'),
          miniFeed
        )
      ),
      el('div', {
        style: {
          marginTop: '12px'
        },
        className: 'panel'
      },
        el('h3', {}, 'Your summary'),
        el('p', {
          className: 'muted'
        }, 'View Projects or Leads to manage items — actions are realtime across browser tabs.')
      )
    );
  }

  // REFACTORED: viewProjects
  function viewProjects(filterQuery = '') {
    const s = requireAuth();
    if (!s) return;
    refs.pageTitle.textContent = 'Projects';
    refs.pageDesc.textContent = 'Create, view and manage projects';

    const projects = CRCData.read(CRCData.KEYS.projects, []);
    const users = CRCData.read(CRCData.KEYS.users, []);

    let list = projects;
    if (s.role === 'customer') list = projects.filter(p => p.customerId === s.id);
    if (s.role === 'referrer') list = projects.filter(p => p.referrerId === s.id);

    if (filterQuery) {
      refs.pageDesc.textContent = `Filtering projects for "${filterQuery}"`;
      list = list.filter(p =>
        (p.location || '').toLowerCase().includes(filterQuery) ||
        p.id.toLowerCase().includes(filterQuery)
      );
    }

    const container = el('div', {
      id: 'projects-list',
      className: 'list',
      style: {
        marginTop: '10px'
      }
    });
    if (!list.length) {
      container.append(el('div', {
        className: 'muted'
      }, 'No projects found.'));
    }

    list.forEach(p => {
      const cust = users.find(u => u.id === p.customerId);
      const ref = users.find(u => u.id === p.referrerId);
      const commissionAmount = Math.round((p.budget || 0) * (p.commissionPercent || 0) / 100);
      const stagesDone = p.stages.filter(s => s.done).length;
      const stagesTotal = p.stages.length;

      container.append(el('div', {
        className: 'item'
      },
        el('div', {
          style: {
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            flex: '1',
            minWidth: '0'
          }
        },
          el('div', {
            style: {
              minWidth: '56px'
            }
          },
            el('div', {
              className: 'pill',
              textContent: p.status
            })
          ),
          el('div', {
            style: {
              flex: '1',
              minWidth: '0'
            }
          },
            el('div', {},
              el('strong', {}, p.location),
              el('span', {
                className: 'muted small'
              }, ` #${p.id}`)
            ),
            el('div', {
              className: 'muted small'
            }, `Customer: ${cust?cust.name:'—'} | Referrer: ${ref?ref.name:'—'}`),
            el('div', {
              className: 'muted small'
            }, `Budget: ${formatCurrency(p.budget)} • Comm: ${formatCurrency(commissionAmount)} (${p.commissionPercent}%)`),
            el('div', {
              className: 'muted small',
              style: {
                marginTop: '6px'
              }
            }, `Stages: ${stagesDone} / ${stagesTotal} complete`)
          )
        ),
        el('div', {
          style: {
            display: 'flex',
            gap: '8px',
            alignItems: 'center'
          }
        },
          el('button', {
            className: 'btn',
            'data-action': 'view',
            'data-id': p.id,
            textContent: 'View'
          }),
          s.role === 'admin' && el('button', {
            className: 'btn',
            'data-action': 'assign',
            'data-id': p.id,
            textContent: 'Assign'
          }),
          (s.role === 'admin' && !p.verified) && el('button', {
            className: 'btn primary',
            'data-action': 'approve',
            'data-id': p.id,
            textContent: 'Approve'
          })
        )
      ));
    });

    // Event delegation for list actions
    container.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-action]');
      if (!btn) return;

      const id = btn.dataset.id;
      const action = btn.dataset.action;

      if (action === 'view') {
        viewProjectDetail(id);
      } else if (action === 'assign') {
        const name = prompt('Contractor name');
        if (!name) return;
        CRCData.updateProject(id, {
          assignedContractor: name,
          status: 'in-progress'
        });
        toast('Contractor assigned');
        render();
      } else if (action === 'approve') {
        CRCData.updateProject(id, {
          verified: true,
          status: 'approved'
        });
        toast('Project approved');
        render();
      }
    });

    // Replace viewArea content
    refs.viewArea.innerHTML = ''; // Clear
    refs.viewArea.append(el('div', {},
      el('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }
      },
        el('h3', {}, `${list.length} projects`),
        el('div', {
          className: 'muted small'
        }, 'Click actions on each project')
      ),
      container
    ));
  }

  // REFACTORED: viewProjectDetail (with inline editing)
  function viewProjectDetail(projectId) {
    const s = requireAuth();
    if (!s) return;
    const project = CRCData.read(CRCData.KEYS.projects, []).find(p => p.id === projectId);
    if (!project) return toast('Project not found');

    const users = CRCData.read(CRCData.KEYS.users, []);
    const cust = users.find(u => u.id === project.customerId);
    const ref = users.find(u => u.id === project.referrerId);

    refs.viewArea.innerHTML = ''; // Clear
    const isAdmin = s.role === 'admin';

    const stagesArea = el('div', {
      id: 'stages-area',
      className: 'list'
    });
    project.stages.forEach(sg => {
      stagesArea.append(el('div', {
        className: 'item'
      },
        el('div', {},
          el('strong', {}, sg.label),
          el('div', {
            className: 'muted small'
          }, sg.done ? 'Done' : 'Pending')
        ),
        // Only admin can toggle stages
        isAdmin && el('button', {
          className: `btn ${sg.done ? 'ghost' : ''}`,
          textContent: sg.done ? 'Reopen' : 'Complete',
          onclick: () => {
            CRCData.toggleStage(project.id, sg.key);
            toast('Stage toggled');
            viewProjectDetail(projectId); // Re-render just this view
          }
        })
      ));
    });

    const detailsPanel = el('div', {
      className: 'panel'
    },
      el('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }
      },
        el('div', {},
          el('h3', {}, `Project #${project.id}`),
          el('div', {
            className: 'muted small'
          }, project.location)
        ),
        el('div', {
          className: 'muted small'
        }, el('strong', {}, `Status: ${project.status}`))
      ),
      el('hr'),
      el('div', {
        style: {
          marginTop: '12px'
        }
      },
        el('p', {}, el('strong', {}, 'Customer: '), `${cust?cust.name:'—'} (${cust?cust.email:'—'})`),
        el('p', {}, el('strong', {}, 'Referrer: '), `${ref?ref.name:'—'}`),
        el('p', {}, el('strong', {}, 'Assigned: '), `${project.assignedContractor || '—'}`),

        // Editable fields for admin
        isAdmin ?
        createEditableField('Budget', project.budget, (newVal) => {
          CRCData.updateProject(project.id, {
            budget: newVal
          });
          toast('Budget updated');
          viewProjectDetail(projectId);
        }, 'number', formatCurrency) :
        el('p', {}, el('strong', {}, 'Budget: '), formatCurrency(project.budget)),

        isAdmin ?
        createEditableField('Commission %', project.commissionPercent, (newVal) => {
          CRCData.updateProject(project.id, {
            commissionPercent: newVal
          });
          toast('Commission updated');
          viewProjectDetail(projectId);
        }, 'number', (v) => `${v}%`) :
        el('p', {}, el('strong', {}, 'Commission: '), `${project.commissionPercent}%`),

        el('div', {
          style: {
            marginTop: '12px'
          }
        },
          el('h4', {}, 'Stages'),
          stagesArea
        )
      )
    );
    refs.viewArea.append(detailsPanel);
  }

  // REFACTORED: viewLeads
  function viewLeads(filterQuery = '') {
    const s = requireAuth();
    if (!s) return;
    refs.pageTitle.textContent = 'Leads';
    refs.pageDesc.textContent = 'Leads submitted by referrers';

    const leads = CRCData.read(CRCData.KEYS.leads, []);
    const users = CRCData.read(CRCData.KEYS.users, []);

    let list = leads;
    if (s.role === 'referrer') list = leads.filter(l => l.referrerId === s.id);

    if (filterQuery) {
      refs.pageDesc.textContent = `Filtering leads for "${filterQuery}"`;
      list = list.filter(l => (l.email || '').toLowerCase().includes(filterQuery));
    }

    const container = el('div', {
      id: 'leads-list',
      className: 'list',
      style: {
        marginTop: '10px'
      }
    });
    if (!list.length) {
      container.innerHTML = `<div class="muted">No leads</div>`;
    }

    list.forEach(l => {
      const ref = users.find(u => u.id === l.referrerId);
      container.append(el('div', {
        className: 'item'
      },
        el('div', {},
          el('div', {}, el('strong', {}, l.email)),
          el('div', {
            className: 'muted small'
          }, `${l.notes || 'No notes'} • Referrer: ${ref ? ref.name : '—'}`)
        ),
        el('div', {
          style: {
            display: 'flex',
            gap: '8px'
          }
        },
          (s.role === 'admin' && l.status === 'new') && el('button', {
            className: 'btn',
            'data-action': 'convert',
            'data-id': l.id,
            textContent: 'Convert'
          }),
          l.status === 'converted' && el('div', {
            className: 'pill',
            textContent: 'Converted'
          })
        )
      ));
    });

    // Event delegation
    container.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-action="convert"]');
      if (!btn) return;

      const id = btn.dataset.id;
      // NEW: Use modal for conversion
      const nameInput = el('input', {
        id: 'modal-conv-name',
        placeholder: 'Customer Full Name'
      });
      const budInput = el('input', {
        id: 'modal-conv-bud',
        type: 'number',
        placeholder: '10000'
      });

      const formContent = el('div', {
        className: 'forms'
      },
        el('label', {}, 'Customer Name', nameInput),
        el('label', {}, 'Initial Budget (USD)', budInput)
      );

      showModal('Convert Lead to Project', formContent, () => {
        const name = nameInput.value.trim();
        const bud = Number(budInput.value) || 0;
        if (!name) {
          toast('Enter customer name');
          return false;
        }
        const res = CRCData.convertLeadToProject(id, name, bud);
        if (res.error) {
          toast(res.error);
          return false;
        }
        toast('Lead converted to project ' + res.project.id);
        render(); // Full re-render
        return true;
      });
    });

    refs.viewArea.innerHTML = ''; // Clear
    refs.viewArea.append(el('div', {},
      el('h3', {}, `${list.length} leads`),
      container
    ));
  }

  function viewProfile() {
    const s = requireAuth();
    if (!s) return;
    refs.pageTitle.textContent = 'Profile';
    refs.pageDesc.textContent = 'Your account';
    refs.viewArea.innerHTML = '';
    refs.viewArea.append(
      el('div', {
        className: 'panel'
      },
        el('h3', {}, s.name),
        el('p', {
          className: 'muted small'
        }, s.email),
        el('p', {}, el('strong', {}, 'Role: '), s.role),
        el('p', {}, el('strong', {}, 'Created: '), new Date(s.createdAt).toLocaleString())
      )
    );
  }

  function viewSettings() {
    const s = requireAuth();
    if (!s) return;
    refs.pageTitle.textContent = 'Settings';
    refs.pageDesc.textContent = 'Application settings';
    const defaults = CRCData.readObj(CRCData.KEYS.defaults, {
      defaultCommission: 6
    });

    const commissionInput = el('input', {
      id: 'default-commission',
      type: 'number',
      value: defaults.defaultCommission,
      min: '0',
      max: '100'
    });

    refs.viewArea.innerHTML = '';
    refs.viewArea.append(
      el('div', {
        className: 'panel'
      },
        el('h3', {}, 'App Defaults'),
        el('label', {}, 'Default commission %', commissionInput),
        el('div', {
          style: {
            marginTop: '10px'
          }
        },
          el('button', {
            id: 'save-defaults',
            className: 'btn',
            textContent: 'Save',
            onclick: () => {
              const val = Number(commissionInput.value);
              if (isNaN(val) || val < 0 || val > 100) return toast('Enter 0-100');
              CRCData.write(CRCData.KEYS.defaults, {
                defaultCommission: val
              });
              toast('Defaults saved');
            }
          })
        )
      )
    );
  }

  // ----------------------------------------
  // Main Render Orchestrator
  // ----------------------------------------
  function render() {
    const session = getSession();
    if (!session) return location.href = 'index.html';

    // Update header/profile
    refs.displayName.textContent = session.name;
    refs.displayRole.textContent = session.role;
    refs.avatar.textContent = session.name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();

    // Get hash and search query
    const hash = (location.hash || '#overview').replace('#', '');
    const q = refs.globalSearch.value.trim().toLowerCase();

    setActiveNav(hash);

    // Dispatch view
    if (hash === 'overview') viewOverview();
    else if (hash === 'projects') viewProjects(q); // Pass query
    else if (hash === 'leads') viewLeads(q); // Pass query
    else if (hash === 'profile') viewProfile();
    else if (hash === 'settings') viewSettings();
    else viewOverview();

    // Update statistics
    refs.sUsers.textContent = CRCData.read(CRCData.KEYS.users, []).length;
    refs.sProjects.textContent = CRCData.read(CRCData.KEYS.projects, []).length;
  }

  // ----------------------------------------
  // Initialize
  // ----------------------------------------
  (function boot() {
    CRCData.seedDemo();
    if (!location.hash) location.hash = 'overview';
    render();

    window.addEventListener('storage', (e) => {
      // Re-render if another tab changed data
      render();
    });
  })();

})();