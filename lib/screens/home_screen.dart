import 'dart:io';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/photo_session.dart';
import '../services/session_store.dart';
import 'camera_screen.dart';
import 'session_detail_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _store = SessionStore.instance;
  late Future<List<PhotoSession>> _future;

  @override
  void initState() {
    super.initState();
    _future = _store.loadAll();
  }

  void _refresh() {
    setState(() => _future = _store.loadAll());
  }

  Future<void> _newBasePhoto() async {
    final result = await Navigator.of(context).push<CaptureResult>(
      MaterialPageRoute(
        builder: (_) => const CameraScreen(title: 'Foto base'),
      ),
    );
    if (result == null) return;

    final path = await _store.persistCapturedImage(result.imagePath, 'base');
    final session = PhotoSession(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      createdAt: DateTime.now(),
      basePhotoPath: path,
      baseDistanceCm: result.distanceCm,
      baseParams: result.params,
    );
    await _store.upsert(session);
    _refresh();
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SessionDetailScreen(sessionId: session.id),
      ),
    );
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fotos Fantasma'),
      ),
      body: FutureBuilder<List<PhotoSession>>(
        future: _future,
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final sessions = snapshot.data!;
          if (sessions.isEmpty) {
            return const _EmptyState();
          }
          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: sessions.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, i) {
              final s = sessions[i];
              return _SessionTile(
                session: s,
                onTap: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          SessionDetailScreen(sessionId: s.id),
                    ),
                  );
                  _refresh();
                },
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _newBasePhoto,
        icon: const Icon(Icons.add_a_photo),
        label: const Text('Nova foto base'),
      ),
    );
  }
}

class _SessionTile extends StatelessWidget {
  final PhotoSession session;
  final VoidCallback onTap;
  const _SessionTile({required this.session, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final df = DateFormat('dd/MM/yyyy HH:mm');
    return Card(
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        leading: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: Image.file(
            File(session.basePhotoPath),
            width: 56,
            height: 56,
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) =>
                const Icon(Icons.broken_image, size: 40),
          ),
        ),
        title: Text('Comparacao de ${df.format(session.createdAt)}'),
        subtitle: Text(
          session.hasFollowUp
              ? 'Base + acompanhamento • ${session.baseDistanceCm.round()} cm'
              : 'So foto base • ${session.baseDistanceCm.round()} cm',
        ),
        trailing: Icon(
          session.hasFollowUp ? Icons.compare : Icons.add_a_photo_outlined,
          color: session.hasFollowUp
              ? Theme.of(context).colorScheme.primary
              : null,
        ),
        onTap: onTap,
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.camera_alt_outlined,
                size: 64, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 16),
            const Text(
              'Nenhuma comparacao ainda',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text(
              'Toque em "Nova foto base" para registrar a primeira foto. '
              'Na proxima consulta, use o Ghost Overlay para tirar a foto de '
              'acompanhamento no mesmo enquadramento.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
