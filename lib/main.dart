import 'package:flutter/material.dart';

import 'screens/home_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const FotosFantasmaApp());
}

class FotosFantasmaApp extends StatelessWidget {
  const FotosFantasmaApp({super.key});

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF1B5E8C); // azul clinico
    return MaterialApp(
      title: 'Fotos Fantasma',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: seed),
        appBarTheme: const AppBarTheme(centerTitle: true),
      ),
      home: const HomeScreen(),
    );
  }
}
