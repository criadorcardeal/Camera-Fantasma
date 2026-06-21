import 'dart:io';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/photo_session.dart';
import '../services/session_store.dart';
import '../widgets/comparison_view.dart';
import 'camera_screen.dart';

class SessionDetailScreen extends StatefulWidget {
  final String sessionId;
  const SessionDetailScreen({super.key, required this.sessionId});

  @override
  State<SessionDetailScreen> createState() => _SessionDetailScreenState();
}

class _SessionDetailScreenState extends State<SessionDetailScreen> {
  final _store = SessionStore.instance;
  PhotoSession? _session;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final all = await _store.loadAll();
    setState(() {
      _session = all.firstWhere(
        (s) => s.id == widget.sessionId,
        orElse: () => all.first,
      );
      _loading = false;
    });
  }

  Future<void> _takeFollowUp() async {
    final s = _session!;
    final result = await Navigator.of(context).push<CaptureResult>(
      MaterialPageRoute(
        builder: (_) => CameraScreen(
          title: 'Foto de acompanhamento',
          ghostImagePath: s.basePhotoPath,
          targetDistanceCm: s.baseDistanceCm,
          initialParams: s.baseParams,
        ),
      ),
    );
    if (result == null) return;
    final path =
        await _store.persistCapturedImage(result.imagePath, 'followup');
    final updated = s.copyWith(
      followUpPhotoPath: path,
      followUpDistanceCm: result.distanceCm,
      followUpAt: DateTime.now(),
    );
    await _store.upsert(updated);
    setState(() => _session = updated);
  }

  Future<void> _confirmDelete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir comparacao?'),
        content: const Text(
            'As fotos desta comparacao serao apagadas do aparelho.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await _store.delete(_session!);
      if (mounted) Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _session == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    final s = _session!;
    final df = DateFormat('dd/MM/yyyy HH:mm');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Comparacao'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            onPressed: _confirmDelete,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          if (s.hasFollowUp)
            ComparisonView(
              beforePath: s.basePhotoPath,
              afterPath: s.followUpPhotoPath!,
            )
          else
            _SinglePhoto(path: s.basePhotoPath),
          const SizedBox(height: 16),
          _InfoRow(
            label: 'Foto base',
            value:
                '${df.format(s.createdAt)} • ${s.baseDistanceCm.round()} cm',
          ),
          if (s.hasFollowUp)
            _InfoRow(
              label: 'Acompanhamento',
              value:
                  '${df.format(s.followUpAt!)} • ${s.followUpDistanceCm!.round()} cm',
            ),
          _InfoRow(
            label: 'Parametros reaplicados',
            value:
                'Exposicao ${s.baseParams.exposureOffset.toStringAsFixed(1)} • '
                'Zoom ${s.baseParams.zoom.toStringAsFixed(1)}x • '
                'Flash ${s.baseParams.flashOn ? "ligado" : "desligado"}',
          ),
          const SizedBox(height: 16),
          if (!s.hasFollowUp)
            FilledButton.icon(
              onPressed: _takeFollowUp,
              icon: const Icon(Icons.compare),
              label: const Text('Tirar foto de acompanhamento'),
            )
          else
            OutlinedButton.icon(
              onPressed: _takeFollowUp,
              icon: const Icon(Icons.refresh),
              label: const Text('Refazer foto de acompanhamento'),
            ),
        ],
      ),
    );
  }
}

class _SinglePhoto extends StatelessWidget {
  final String path;
  const _SinglePhoto({required this.path});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.file(File(path), fit: BoxFit.contain),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 140,
            child: Text(label,
                style: const TextStyle(fontWeight: FontWeight.bold)),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}
