const express = require('express');
const logger = require('../../logger');
const { db } = require('../../database');
const { sendNotification } = require('../services/notifications');

const router = express.Router();
router.get('/api/maintenance', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const tasks = (await db.prepare(`
      SELECT * FROM maintenance_tasks 
      ORDER BY next_due ASC NULLS LAST, task_name ASC
    `).all());
    
    // Get print hours per printer
    const printerHours = {};
    const allPrints = (await db.prepare('SELECT deviceId, costTime FROM prints').all());
    let totalPrintSeconds = 0;
    
    for (const print of allPrints) {
      if (print.costTime) {
        totalPrintSeconds += print.costTime;
        if (print.deviceId) {
          if (!printerHours[print.deviceId]) {
            printerHours[print.deviceId] = 0;
          }
          printerHours[print.deviceId] += print.costTime;
        }
      }
    }
    const totalPrintHours = totalPrintSeconds / 3600;
    
    // Check for overdue tasks based on print hours
    logger.debug(`[Maintenance] Total print hours: ${totalPrintHours.toFixed(2)}`);
    Object.keys(printerHours).forEach(pid => {
      logger.debug(`[Maintenance] Printer ${pid}: ${(printerHours[pid] / 3600).toFixed(2)} hrs`);
    });
    
    const tasksWithStatus = await Promise.all(tasks.map(async task => {
      // Use printer-specific hours if task is assigned to a printer
      const currentPrintHours = task.printer_id && printerHours[task.printer_id]
        ? printerHours[task.printer_id] / 3600
        : totalPrintHours;
      let isOverdue = false;
      let isDueSoon = false;
      let hoursUntilDue = null;
      
      logger.debug(`[Maintenance] Task "${task.task_name}": DB hours_until_due=${task.hours_until_due}, interval=${task.interval_hours}`);
      
      if (task.hours_until_due !== null && task.hours_until_due !== undefined) {
        // hours_until_due stores the ABSOLUTE hour marker when maintenance is due
        // e.g., if total print hours is 1000 and task is due at 2222, then 2222 - 1000 = 1222 hrs remaining
        hoursUntilDue = task.hours_until_due - currentPrintHours;
        logger.debug(`[Maintenance] Task "${task.task_name}": Calculated ${task.hours_until_due} - ${currentPrintHours.toFixed(2)} = ${hoursUntilDue.toFixed(2)} hrs remaining`);
        isOverdue = hoursUntilDue < 0;
        isDueSoon = !isOverdue && hoursUntilDue <= 20;
      } else if (task.next_due && task.interval_hours) {
        // Fallback: Calculate from next_due and interval_hours
        // If next_due exists but hours_until_due is null, initialize it now
        logger.debug(`[Maintenance] Task "${task.task_name}": hours_until_due is NULL, calculating from interval...`);
        
        // If never performed, due at current + interval
        // If last_performed exists, calculate from that
        if (task.last_performed) {
          // The task was completed before hours_until_due column existed
          // We need to retroactively calculate when it should be due
          // This is tricky because we don't know the print hours at completion time
          // Best guess: use next_due time-based as a fallback
          const now = new Date().toISOString();
          isOverdue = task.next_due < now;
          isDueSoon = !isOverdue && new Date(task.next_due) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          
          // Try to initialize hours_until_due for this task
          const taskNextDueHours = currentPrintHours + task.interval_hours;
          try {
            (await db.prepare('UPDATE maintenance_tasks SET hours_until_due = ? WHERE id = ?').run(taskNextDueHours, task.id));
            logger.debug(`[Maintenance] Initialized hours_until_due=${taskNextDueHours} for task ${task.id}`);
            hoursUntilDue = task.interval_hours; // Since we just set it to current + interval
          } catch (e) {
            logger.warn(`[Maintenance] Failed to initialize hours_until_due: ${e.message}`);
          }
        } else {
          // New task never performed - set it to be due at current + interval
          hoursUntilDue = task.interval_hours;
          const taskNextDueHours = currentPrintHours + task.interval_hours;
          try {
            (await db.prepare('UPDATE maintenance_tasks SET hours_until_due = ? WHERE id = ?').run(taskNextDueHours, task.id));
            logger.debug(`[Maintenance] Initialized new task hours_until_due=${taskNextDueHours} for task ${task.id}`);
          } catch (e) {
            logger.warn(`[Maintenance] Failed to initialize hours_until_due: ${e.message}`);
          }
          isDueSoon = hoursUntilDue <= 20;
        }
      } else {
        // Fallback to time-based if neither hours_until_due nor next_due is set
        console.log(`[Maintenance GET] Task "${task.task_name}": Using time-based fallback, next_due=${task.next_due}`);
        const now = new Date().toISOString();
        isOverdue = task.next_due && task.next_due < now;
        isDueSoon = !isOverdue && task.next_due && new Date(task.next_due) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      }
      
      return {
        ...task,
        isOverdue,
        isDueSoon,
        hours_until_due: hoursUntilDue
      };
    }));

    res.json(tasksWithStatus);
  } catch (error) {
    console.error('Get maintenance tasks error:', error);
    res.status(500).json({ error: 'Failed to get maintenance tasks' });
  }
});

router.post('/api/maintenance', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = (await db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId));
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { printer_id, task_name, task_type, description, interval_hours } = req.body;
    
    if (!task_name || !task_type) {
      return res.status(400).json({ error: 'Task name and type are required' });
    }
    
    // Calculate current total print hours
    const prints = (await db.prepare('SELECT costTime FROM prints').all());
    let totalPrintSeconds = 0;
    for (const print of prints) {
      if (print.costTime) {
        totalPrintSeconds += print.costTime;
      }
    }
    const currentPrintHours = totalPrintSeconds / 3600;
    
    // New tasks should be due at: current print hours + interval
    const taskInterval = interval_hours || 100;
    const initialDueHours = currentPrintHours + taskInterval;
    
    console.log(`[Maintenance Create] Creating task "${task_name}"`);
    console.log(`  - Current print hours: ${currentPrintHours.toFixed(2)}`);
    console.log(`  - Interval: ${taskInterval} hours`);
    console.log(`  - Will be due at print hour: ${initialDueHours.toFixed(2)}`);
    
    const result = (await db.prepare(`
      INSERT INTO maintenance_tasks (printer_id, task_name, task_type, description, interval_hours, hours_until_due)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(printer_id || null, task_name, task_type, description || '', taskInterval, initialDueHours));
    
    const task = (await db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(result.lastInsertRowid));
    
    res.json({ success: true, task });
  } catch (error) {
    console.error('Create maintenance task error:', error);
    res.status(500).json({ error: 'Failed to create maintenance task' });
  }
});

router.put('/api/maintenance/:id', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = (await db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId));
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { id } = req.params;
    const { printer_id, task_name, task_type, description, interval_hours } = req.body;
    
    // Get old task to check if interval changed
    const oldTask = (await db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(id));
    
    (await db.prepare(`
      UPDATE maintenance_tasks 
      SET printer_id = ?, task_name = ?, task_type = ?, description = ?, interval_hours = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(printer_id || null, task_name, task_type, description || '', interval_hours || 100, id));
    
    // If interval changed and task has been performed, recalculate hours_until_due
    if (oldTask && oldTask.interval_hours !== interval_hours && oldTask.last_performed) {
      // Calculate current print hours
      const prints = (await db.prepare('SELECT costTime FROM prints').all());
      let totalPrintSeconds = 0;
      for (const print of prints) {
        if (print.costTime) {
          totalPrintSeconds += print.costTime;
        }
      }
      const currentPrintHours = totalPrintSeconds / 3600;
      
      // Recalculate: if last performed, new due = current + new interval
      const newDueHours = currentPrintHours + interval_hours;
      
      try {
        (await db.prepare('UPDATE maintenance_tasks SET hours_until_due = ? WHERE id = ?').run(newDueHours, id));
        console.log(`[Maintenance Update] Recalculated hours_until_due to ${newDueHours.toFixed(2)} for task ${id} (interval changed from ${oldTask.interval_hours} to ${interval_hours})`);
      } catch (e) {
        console.error(`[Maintenance Update] Failed to recalculate hours_until_due:`, e.message);
      }
    }
    
    const task = (await db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(id));
    
    res.json({ success: true, task });
  } catch (error) {
    console.error('Update maintenance task error:', error);
    res.status(500).json({ error: 'Failed to update maintenance task' });
  }
});

router.delete('/api/maintenance/:id', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = (await db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId));
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  try {
    const { id } = req.params;
    (await db.prepare('DELETE FROM maintenance_tasks WHERE id = ?').run(id));
    res.json({ success: true });
  } catch (error) {
    console.error('Delete maintenance task error:', error);
    res.status(500).json({ error: 'Failed to delete maintenance task' });
  }
});

router.post('/api/maintenance/:id/complete', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const { id } = req.params;
    const { notes } = req.body; // Optional notes from user
    const task = (await db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(id));
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const now = new Date();
    
    // Calculate next due based on print hours, not real time
    // Get total print hours from all prints
    const prints = (await db.prepare('SELECT costTime FROM prints').all());
    let totalPrintSeconds = 0;
    for (const print of prints) {
      if (print.costTime) {
        totalPrintSeconds += print.costTime;
      }
    }
    const totalPrintHours = totalPrintSeconds / 3600;
    
    // Calculate the ABSOLUTE print hour marker when this task will be due
    // This is the key: we store when (in terms of total print hours) the task should be due
    const nextDueHours = totalPrintHours + task.interval_hours;
    
    // Also store a timestamp for next_due (for time-based fallback and UI display)
    const nextDue = new Date(now.getTime() + task.interval_hours * 60 * 60 * 1000);
    
    console.log(`[Maintenance Complete] Task ${id} "${task.task_name}":`);
    console.log(`  - Current total print hours: ${totalPrintHours.toFixed(2)}`);
    console.log(`  - Task interval: ${task.interval_hours} hours`);
    console.log(`  - Next due at print hour: ${nextDueHours.toFixed(2)}`);
    console.log(`  - Hours remaining until due: ${task.interval_hours.toFixed(2)}`);
    
    // Update the task with both timestamp and absolute hour marker
    (await db.prepare(`
      UPDATE maintenance_tasks 
      SET last_performed = ?, 
          next_due = ?, 
          hours_until_due = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(now.toISOString(), nextDue.toISOString(), nextDueHours, id));
    
    // Log completion to history
    (await db.prepare(`
      INSERT INTO maintenance_history (task_id, task_name, printer_id, completed_at, print_hours_at_completion, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, task.task_name, task.printer_id, now.toISOString(), totalPrintHours, notes || null));
    
    const updatedTask = (await db.prepare('SELECT * FROM maintenance_tasks WHERE id = ?').get(id));
    console.log(`[Maintenance Complete] Task updated successfully. hours_until_due=${updatedTask.hours_until_due}`);
    
    // Send notification
    try {
      const printerName = updatedTask.printer_id ? 
        (await db.prepare('SELECT deviceName FROM printers WHERE deviceId = ?').get(updatedTask.printer_id))?.deviceName || updatedTask.printer_id
        : 'All Printers';
      
      await sendNotification('maintenance', {
        status: 'completed',
        message: `Maintenance task "${updatedTask.task_name}" has been completed!`,
        taskName: updatedTask.task_name,
        printerName: printerName,
        currentHours: totalPrintHours,
        dueAtHours: nextDueHours
      });
    } catch (notifError) {
      console.error('Failed to send notification:', notifError);
    }
    
    res.json({ success: true, task: updatedTask });
  } catch (error) {
    console.error('Complete maintenance task error:', error);
    res.status(500).json({ error: 'Failed to complete maintenance task' });
  }
});

// Get maintenance history for a task
router.get('/api/maintenance/:id/history', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const { id } = req.params;
    const history = (await db.prepare(`
      SELECT * FROM maintenance_history 
      WHERE task_id = ? 
      ORDER BY completed_at DESC
    `).all(id));
    
    res.json(history);
  } catch (error) {
    console.error('Get maintenance history error:', error);
    res.status(500).json({ error: 'Failed to get maintenance history' });
  }
});

// Get maintenance summary/stats
router.get('/api/maintenance/summary', async (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    // Get current total print hours
    const prints = (await db.prepare('SELECT costTime FROM prints').all());
    let totalPrintSeconds = 0;
    for (const print of prints) {
      if (print.costTime) {
        totalPrintSeconds += print.costTime;
      }
    }
    const currentPrintHours = totalPrintSeconds / 3600;
    
    const allTasks = (await db.prepare('SELECT * FROM maintenance_tasks').all());
    const total = allTasks.length;
    const neverDone = allTasks.filter(t => !t.last_performed).length;
    
    // Count overdue and due-soon based on print hours
    let overdue = 0;
    let dueSoon = 0;
    
    for (const task of allTasks) {
      if (task.hours_until_due) {
        if (currentPrintHours >= task.hours_until_due) {
          overdue++;
        } else if (task.hours_until_due - currentPrintHours <= 50) {
          dueSoon++;
        }
      }
    }
    
    res.json({
      total,
      overdue,
      dueSoon,
      neverDone,
      upToDate: total - overdue - dueSoon - neverDone
    });
  } catch (error) {
    console.error('Get maintenance summary error:', error);
    res.status(500).json({ error: 'Failed to get maintenance summary' });
  }
});

module.exports = router;
